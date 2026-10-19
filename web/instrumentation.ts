// Local proof diagnostics; fixture-only environment contains no credentials.
export function onRequestError(error: unknown) { console.error("SPIKE_REQUEST_ERROR", error); }
