const fetchFromNetwork = globalThis.fetch;

globalThis.fetch = async (input, options) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    const request = new Request(input, options);
    const data = await request
      .clone()
      .json()
      .catch(async () => Object.fromEntries(await request.formData()));
    const valid = data.response === "browser-fixture-token";
    return Response.json({
      success: valid,
      hostname: "localhost",
      "error-codes": valid ? [] : ["invalid-input-response"],
    });
  }
  return fetchFromNetwork(input, options);
};
