import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPublicUrlDispatchers,
  isPublicIpAddress,
  parsePublicHttpUrl,
  publicUrlDispatcher,
  resolvePublicAddresses,
} from "../lib/security/safe-url.js";

test.after(async () => clearPublicUrlDispatchers());

test("bloquea loopback, redes privadas, link-local y metadata cloud", async () => {
  const blocked = [
    "http://127.0.0.1/admin",
    "http://10.2.3.4/",
    "http://172.16.1.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://metadata.google.internal/",
  ];
  for (const url of blocked) {
    assert.throws(() => parsePublicHttpUrl(url), { code: "UNSAFE_URL" });
  }
});

test("rechaza un hostname cuando cualquiera de sus respuestas DNS no es pública", async () => {
  const lookup = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];
  await assert.rejects(resolvePublicAddresses("https://example.com/a", lookup), { code: "UNSAFE_URL" });
});

test("el dispatcher fija una resolución pública y no consulta DNS por conexión", async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return [{ address: calls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
  };
  const first = await publicUrlDispatcher("https://safe.example/document", { lookupImpl: lookup });
  const second = await publicUrlDispatcher("https://safe.example/other", { lookupImpl: lookup });
  assert.equal(first, second);
  assert.equal(calls, 1);
});

test("clasifica únicamente direcciones globales", () => {
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicIpAddress("100.64.0.1"), false);
  assert.equal(isPublicIpAddress("2001:db8::1"), false);
});
