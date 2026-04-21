export function formatTerminalClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear() + 7000;
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
