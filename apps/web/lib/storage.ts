import "server-only";
import { saveFile, storagePathFor } from "@bodh/integrations/storage";

export { readFileBytes, saveFile, signedUrl, storagePathFor, usesGcs as usesSignedUrls, imageSize } from "@bodh/integrations/storage";

export async function saveUpload(name: string, data: ArrayBuffer, contentType: string): Promise<string> {
  const path = storagePathFor("uploads", name);
  await saveFile(path, Buffer.from(data), contentType);
  return path;
}
