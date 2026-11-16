export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(error, _request, response, _next) {
  if (error?.type === "entity.too.large") {
    return response.status(413).json({
      error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." },
    });
  }

  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({
      error: { code: "INVALID_JSON", message: "The request body must be valid JSON." },
    });
  }

  if (error?.name === "ZodError") {
    return response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request contains invalid values.",
        details: error.issues.map(({ path, message }) => ({ field: path.join("."), message })),
      },
    });
  }

  if (error?.code === "ER_DUP_ENTRY") {
    return response.status(409).json({
      error: { code: "CONFLICT", message: "A record with those details already exists." },
    });
  }

  if (error instanceof HttpError) {
    return response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  console.error("Unhandled API error:", error);
  return response.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." },
  });
}
