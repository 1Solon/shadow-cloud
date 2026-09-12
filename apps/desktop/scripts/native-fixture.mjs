import { createServer } from "node:http";

// Development-only native acceptance server. Every request remains on loopback;
// the synthetic account has no relationship to any live Shadow Cloud account.
export async function startNativeFixture(version) {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/companion/protocol") {
      response.end(JSON.stringify({ protocolVersion: version }));
    } else if (request.url === "/v1/companion/campaigns") {
      response.end(JSON.stringify({ campaigns: [] }));
    } else if (request.url === "/v1/auth/device-sessions/exchange") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) {
          request.destroy();
          return;
        }
      }
      if (JSON.parse(body).handoffToken !== "native-synthetic-token") {
        response.writeHead(401).end("{}");
        return;
      }
      response.end(
        JSON.stringify({
          accessToken: "native-synthetic-access",
          accessTokenExpiresAt: "2037-01-01T00:00:00Z",
          refreshToken: "native-synthetic-refresh",
          deviceSession: {
            id: "native-synthetic-device",
            expiresAt: "2037-01-01T00:00:00Z",
            scopes: ["campaigns:observe", "saves:download", "turns:submit"],
            user: {
              id: "native-synthetic-account",
              email: "native@example.test",
              displayName: "Native Test Player",
            },
          },
        }),
      );
    } else {
      // Browser approval intentionally fails, exposing the real token fallback
      // without opening a browser or invoking another OS application.
      response.writeHead(503).end("{}");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
