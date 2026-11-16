import { ApiError } from "./api";

async function downloadFile(path: string, filename: string, contentType: string) {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { credentials: "include" });
  } catch {
    throw new ApiError("The PDF could not be downloaded because the API server is unavailable.", 0, "API_UNAVAILABLE");
  }
  if (!response.ok) {
    let message = "The PDF could not be generated.";
    try {
      const body = await response.json() as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      message = `The PDF request failed with status ${response.status}.`;
    }
    throw new ApiError(message, response.status, "PDF_DOWNLOAD_FAILED");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes(contentType)) {
    throw new ApiError(`The server did not return a ${contentType} file.`, response.status, "INVALID_DOWNLOAD_RESPONSE");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPdf(path: string, filename: string) {
  return downloadFile(path, filename, "application/pdf");
}

export function downloadCsv(path: string, filename: string) {
  return downloadFile(path, filename, "text/csv");
}
