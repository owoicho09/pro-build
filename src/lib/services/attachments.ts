import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AttachmentKind } from "@/db/types";
import type { BuilderAttachment } from "./builder-engine";

const BUCKET = "attachments";
const SIGNED_URL_TTL_SECONDS = 60 * 10; // long enough for v0 to fetch it

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PLAIN_TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);
const PDF_TYPE = "application/pdf";

function classify(mimeType: string): AttachmentKind {
  if (IMAGE_TYPES.has(mimeType)) return "image";
  if (PLAIN_TEXT_TYPES.has(mimeType) || mimeType === PDF_TYPE) return "document";
  return "other";
}

export interface UploadedAttachment {
  id: string;
  kind: AttachmentKind;
  originalFilename: string;
  usable: boolean;
}

// Uploads one file to Storage, extracts text for documents where possible,
// and records an `attachments` row. Never throws on an unsupported/corrupt
// file — it records the attempt with `usable: false` so the caller can tell
// the user honestly, per spec: "if a file type cannot be understood... tell
// the user rather than pretending it was used."
export async function uploadAttachment(
  supabase: SupabaseClient<Database>,
  input: { ownerId: string; projectId: string; file: File },
): Promise<UploadedAttachment> {
  const kind = classify(input.file.type);
  const storagePath = `${input.ownerId}/${input.projectId}/${randomUUID()}-${input.file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.file, { contentType: input.file.type });

  if (uploadError) {
    const { data: row } = await supabase
      .from("attachments")
      .insert({
        project_id: input.projectId,
        owner_id: input.ownerId,
        storage_path: storagePath,
        mime_type: input.file.type || "application/octet-stream",
        original_filename: input.file.name,
        kind: "other",
        included_in_builder: false,
      })
      .select("id")
      .single();
    return { id: row?.id ?? "", kind: "other", originalFilename: input.file.name, usable: false };
  }

  let extractedText: string | null = null;
  let usable = kind === "image";

  if (input.file.type === PDF_TYPE) {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const buffer = new Uint8Array(await input.file.arrayBuffer());
      const pdf = await getDocumentProxy(buffer);
      const { text } = await extractText(pdf, { mergePages: true });
      if (text.trim()) {
        extractedText = text;
        usable = true;
      }
    } catch (err) {
      console.error("PDF text extraction failed for", input.file.name, err);
    }
  } else if (PLAIN_TEXT_TYPES.has(input.file.type)) {
    usable = true;
  }

  const { data: row, error: insertError } = await supabase
    .from("attachments")
    .insert({
      project_id: input.projectId,
      owner_id: input.ownerId,
      storage_path: storagePath,
      mime_type: input.file.type || "application/octet-stream",
      original_filename: input.file.name,
      kind,
      extracted_text: extractedText,
      included_in_builder: false,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    return { id: "", kind, originalFilename: input.file.name, usable: false };
  }

  return { id: row.id, kind, originalFilename: input.file.name, usable };
}

const MAX_ATTACHMENTS_PER_MESSAGE = 5;

// Uploads every file under `fieldName` in a submitted form. Used by both the
// new-project form and the workspace's follow-up message form so they share
// one implementation.
export async function uploadAttachmentsFromFormData(
  supabase: SupabaseClient<Database>,
  input: { ownerId: string; projectId: string; formData: FormData; fieldName: string },
): Promise<string[]> {
  const files = input.formData
    .getAll(input.fieldName)
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

  const ids: string[] = [];
  for (const file of files) {
    const uploaded = await uploadAttachment(supabase, {
      ownerId: input.ownerId,
      projectId: input.projectId,
      file,
    });
    if (uploaded.id) {
      ids.push(uploaded.id);
    }
  }
  return ids;
}

// Resolves usable attachments into the {url} shape v0's attachments API
// requires, links them to the triggering message, and leaves unusable ones
// alone (still on the project, just never sent to the builder).
export async function resolveAttachmentsForBuilder(
  supabase: SupabaseClient<Database>,
  input: { attachmentIds: string[]; messageId: string },
): Promise<{ builderAttachments: BuilderAttachment[]; skipped: string[] }> {
  if (input.attachmentIds.length === 0) {
    return { builderAttachments: [], skipped: [] };
  }

  const { data: rows } = await supabase
    .from("attachments")
    .select("*")
    .in("id", input.attachmentIds);

  const builderAttachments: BuilderAttachment[] = [];
  const skipped: string[] = [];
  const usedIds: string[] = [];
  const skippedIds: string[] = [];

  for (const row of rows ?? []) {
    if (row.kind === "other" || (row.kind === "document" && !row.extracted_text)) {
      skipped.push(row.original_filename);
      skippedIds.push(row.id);
      continue;
    }

    let sourcePath = row.storage_path;

    // Documents go in as their extracted plain text, not the original
    // bytes — v0's attachments API only accepts a URL, and there's no
    // guarantee it fetches/parses a PDF at that URL the way we need, so we
    // upload the text we already extracted as a small companion file.
    if (row.kind === "document" && row.extracted_text) {
      const textPath = `${row.storage_path}.extracted.txt`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(textPath, new Blob([row.extracted_text], { type: "text/plain" }), {
          contentType: "text/plain",
          upsert: true,
        });
      if (error) {
        skipped.push(row.original_filename);
        skippedIds.push(row.id);
        continue;
      }
      sourcePath = textPath;
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(sourcePath, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed) {
      skipped.push(row.original_filename);
      skippedIds.push(row.id);
      continue;
    }

    builderAttachments.push({ url: signed.signedUrl });
    usedIds.push(row.id);
  }

  if (usedIds.length > 0) {
    await supabase
      .from("attachments")
      .update({ message_id: input.messageId, included_in_builder: true })
      .in("id", usedIds);
  }

  if (skippedIds.length > 0) {
    await supabase
      .from("attachments")
      .update({ message_id: input.messageId })
      .in("id", skippedIds);
  }

  return { builderAttachments, skipped };
}
