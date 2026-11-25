// Roda no navegador. Foto de celular passa facil de 4,5 MB, que e o limite do corpo
// de uma funcao na Vercel. Nos documentos, reduzo a copia enviada para a IA. A mesma
// funcao tambem prepara fotos antes do Storage (lib/documentos e lib/diario).

export async function reduzirParaIA(
  arquivo: File,
  maxLado = 1800,
  qualidade = 0.85,
): Promise<Blob> {
  if (!arquivo.type.startsWith("image/")) return arquivo;

  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) return arquivo;
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? arquivo), "image/jpeg", qualidade);
  });
}

export function extensaoDoArquivo(arquivo: File): string {
  const daNome = arquivo.name.includes(".")
    ? arquivo.name.split(".").pop()!.toLowerCase()
    : "";
  if (daNome) return daNome;
  if (arquivo.type === "application/pdf") return "pdf";
  if (arquivo.type.startsWith("image/")) return arquivo.type.split("/")[1];
  return "bin";
}
