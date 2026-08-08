import assert from "node:assert/strict";
import test from "node:test";
import { verifyUrls } from "../lib/titulos/verify.js";

const response = (status, location = null) => ({
  status,
  headers: {
    get(name) {
      if (name.toLowerCase() === "location") return location;
      if (name.toLowerCase() === "content-type") return "text/html";
      return null;
    },
  },
  async text() { return "<html>documento</html>"; },
});

test("SSRF: no consulta IPs privadas ni metadata cloud", async () => {
  let requested = false;
  const fetchImpl = async () => {
    requested = true;
    return response(200);
  };
  const result = await verifyUrls([
    "http://127.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
  ], { fetchImpl, concurrency: 1 });
  assert.equal(requested, false);
  assert.deepEqual(result.noVerificables.sort(), [
    "http://127.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
  ].sort());
});

test("SSRF: vuelve a validar el destino de cada redirección", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return response(302, "http://10.0.0.8/admin");
  };
  const result = await verifyUrls(["https://example.com/document"], {
    fetchImpl,
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.deepEqual(requested, ["https://example.com/document"]);
  assert.deepEqual(result.noVerificables, ["https://example.com/document"]);
});

test("SSRF: DNS mixto público/privado se rechaza antes del fetch", async () => {
  let requested = false;
  const result = await verifyUrls(["https://rebinding.example/document"], {
    fetchImpl: async () => {
      requested = true;
      return response(200);
    },
    lookupImpl: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ],
  });
  assert.equal(requested, false);
  assert.deepEqual(result.noVerificables, ["https://rebinding.example/document"]);
});
