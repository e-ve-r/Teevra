// Resize locally before upload to keep the model request small on mobile networks.
export async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB.");
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const scale = Math.min(
      1,
      1280 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not process this image.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.76),
    );
    if (!blob || blob.size > 5 * 1024 * 1024)
      throw new Error("Could not compress this image. Please choose another.");
    return new File(
      [blob],
      `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`,
      { type: "image/jpeg" },
    );
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
