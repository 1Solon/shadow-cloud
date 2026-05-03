type ApiPortEnvironment = {
  PORT?: string;
  API_PORT?: string;
};

function parsePort(value: string | undefined) {
  if (!value) {
    return null;
  }

  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) ? port : null;
}

export function resolveApiPort(environment: ApiPortEnvironment) {
  return parsePort(environment.PORT) ?? parsePort(environment.API_PORT) ?? 3001;
}
