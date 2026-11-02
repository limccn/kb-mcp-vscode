import * as assert from "node:assert/strict";
import {
  DEFAULT_HOST,
  adminBaseUrl,
  connectHost,
  hostPort,
  isNonLoopback,
  parseHost,
} from "../../host";

describe("parseHost", () => {
  it("defaults empty and missing values to loopback", () => {
    for (const raw of [undefined, null, "", "   "]) {
      assert.deepEqual(parseHost(raw), {
        listen: DEFAULT_HOST,
        connect: DEFAULT_HOST,
        urlHost: DEFAULT_HOST,
        nonLoopback: false,
        error: null,
      });
    }
  });

  it("keeps IPv4 loopback addresses as written", () => {
    assert.deepEqual(parseHost("127.0.0.2"), {
      listen: "127.0.0.2",
      connect: "127.0.0.2",
      urlHost: "127.0.0.2",
      nonLoopback: false,
      error: null,
    });
  });

  it("accepts localhost case-insensitively", () => {
    const binding = parseHost("LocalHost");
    assert.equal(binding.listen, "LocalHost");
    assert.equal(binding.connect, "LocalHost");
    assert.equal(binding.nonLoopback, false);
    assert.equal(binding.error, null);
  });

  it("maps the IPv4 wildcard back to loopback for clients", () => {
    assert.deepEqual(parseHost("0.0.0.0"), {
      listen: "0.0.0.0",
      connect: "127.0.0.1",
      urlHost: "127.0.0.1",
      nonLoopback: true,
      error: null,
    });
  });

  it("accepts IPv6 loopback with or without brackets", () => {
    const expected = {
      listen: "::1",
      connect: "::1",
      urlHost: "[::1]",
      nonLoopback: false,
      error: null,
    };
    assert.deepEqual(parseHost("::1"), expected);
    assert.deepEqual(parseHost("[::1]"), expected);
    assert.deepEqual(parseHost(" [::1] "), expected);
  });

  it("maps the IPv6 wildcard back to loopback for clients", () => {
    assert.deepEqual(parseHost("::"), {
      listen: "::",
      connect: "::1",
      urlHost: "[::1]",
      nonLoopback: true,
      error: null,
    });
  });

  it("brackets concrete IPv6 addresses in URLs", () => {
    const binding = parseHost("fe80::1");
    assert.equal(binding.listen, "fe80::1");
    assert.equal(binding.urlHost, "[fe80::1]");
    assert.equal(binding.nonLoopback, true);
  });

  it("marks concrete IPv4 addresses as non-loopback", () => {
    assert.equal(parseHost("192.168.1.5").nonLoopback, true);
  });

  it("rejects DNS names and malformed values", () => {
    for (const raw of ["example.com", "127.0.0.999", "not a host"]) {
      const binding = parseHost(raw);
      assert.equal(binding.listen, DEFAULT_HOST);
      assert.equal(binding.nonLoopback, false);
      assert.match(binding.error ?? "", /invalid host/);
      assert.ok(binding.error?.includes(JSON.stringify(raw)));
    }
  });
});

describe("host helpers", () => {
  it("connectHost applies the wildcard mapping", () => {
    assert.equal(connectHost("0.0.0.0"), "127.0.0.1");
    assert.equal(connectHost("::"), "::1");
    assert.equal(connectHost("[::1]"), "::1");
    assert.equal(connectHost(undefined), DEFAULT_HOST);
  });

  it("isNonLoopback flags wildcards and LAN addresses", () => {
    assert.equal(isNonLoopback("127.0.0.1"), false);
    assert.equal(isNonLoopback("::1"), false);
    assert.equal(isNonLoopback("0.0.0.0"), true);
    assert.equal(isNonLoopback("192.168.1.5"), true);
  });

  it("hostPort brackets IPv6 and keeps the port optional", () => {
    assert.equal(hostPort("::1", 51888), "[::1]:51888");
    assert.equal(hostPort("0.0.0.0", 8888), "127.0.0.1:8888");
    assert.equal(hostPort("127.0.0.1", null), "127.0.0.1");
  });

  it("adminBaseUrl returns null without a port", () => {
    assert.equal(adminBaseUrl({ host: "127.0.0.1", port: null }), null);
  });

  it("adminBaseUrl builds bracketed IPv6 and maps wildcards", () => {
    assert.equal(adminBaseUrl({ host: "::1", port: 8899 }), "http://[::1]:8899");
    assert.equal(adminBaseUrl({ host: "0.0.0.0", port: 8899 }), "http://127.0.0.1:8899");
    assert.equal(adminBaseUrl({ port: 8899 }), "http://127.0.0.1:8899");
  });
});