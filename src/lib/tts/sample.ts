const PREFIX = "data:audio/wav;base64,";

/** The bytes inside a `data:audio/wav;base64,...` address. The app's page may not play `data:` addresses (its security rules only allow `blob:`), so the sample is turned into a Blob first. */
export function wavBytesFromAddress(address: string): Uint8Array<ArrayBuffer> {
  if (!address.startsWith(PREFIX)) throw new Error("The voice sample is not a WAV address.");
  const binary = atob(address.slice(PREFIX.length));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
