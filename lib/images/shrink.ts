/**
 * Browser-only. Shrinks a phone photo to ≤1600px JPEG so uploads stay small on
 * a cell connection and under the server's request size limit.
 */
export async function shrinkPhoto(file: File, name = "photo.jpg"): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 600_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    return blob ? new File([blob], name, { type: "image/jpeg" }) : file;
  } catch {
    return file; // e.g. HEIC on a browser that can't decode it; send as-is.
  }
}
