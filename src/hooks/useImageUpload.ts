/**
 * useImageUpload — Upload images to agentic maw-js /api/upload endpoint.
 * Returns upload state, pending attachments, and helpers.
 */
import { useState, useRef, useCallback } from "react";
import { apiUrl } from "../lib/api";

export interface UploadedImage {
  filename: string;
  url: string;
  localUrl: string;
  size: number;
  mimeType: string;
}

export function useImageUpload() {
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<UploadedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File): Promise<UploadedImage | null> => {
    if (!file.type.startsWith("image/")) {
      setError("Only images allowed");
      return null;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Max 10MB");
      return null;
    }

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl("/api/upload"), { method: "POST", body: form });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Upload failed");
      const img: UploadedImage = {
        filename: data.filename,
        url: data.url,
        localUrl: data.url, // same origin, no separate localUrl needed
        size: data.size || file.size,
        mimeType: data.type || file.type,
      };
      setPending(prev => [...prev, img]);
      return img;
    } catch (e: any) {
      setError(e.message || "Upload failed");
      return null;
    } finally {
      setUploading(false);
    }
  }, []);

  const pickFile = useCallback(() => inputRef.current?.click(), []);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await upload(file);
    }
    if (inputRef.current) inputRef.current.value = "";
  }, [upload]);

  const removeImage = useCallback((filename: string) => {
    setPending(prev => prev.filter(img => img.filename !== filename));
  }, []);

  const clearAll = useCallback(() => {
    setPending([]);
    setError(null);
  }, []);

  /** Build message text with image URLs appended */
  const buildMessage = useCallback((text: string): string => {
    if (pending.length === 0) return text;
    const urls = pending.map(img => img.url);
    const suffix = pending.length === 1
      ? `\n[attached image] ${urls[0]}`
      : `\n[${pending.length} images attached]\n${urls.map((u, i) => `- ${pending[i].filename}: ${u}`).join("\n")}`;
    return text ? text + suffix : suffix.trim();
  }, [pending]);

  return {
    uploading,
    pending,
    error,
    inputRef,
    upload,
    pickFile,
    onFileChange,
    removeImage,
    clearAll,
    buildMessage,
  };
}
