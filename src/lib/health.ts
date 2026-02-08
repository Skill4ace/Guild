export type HealthStatus = {
  status: "ok";
  service: string;
  timestamp: string;
};

export function getHealthStatus(): HealthStatus {
  return {
    status: "ok",
    service: "guild-web",
    timestamp: new Date().toISOString(),
  };
}
