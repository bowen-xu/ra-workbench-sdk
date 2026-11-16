import {spawn} from "node:child_process";
import {appendFileSync, writeFileSync} from "node:fs";

/** Keep machine-readable stdout available to the caller and stream build logs
 * on stderr, including while a compiler or package installation is running. */
export async function runBuildCommand(label, command, args, options, log) {
  const started = Date.now();
  writeFileSync(log, "");
  const machineOutput = args.some(value => value.includes("json") || value === "--listFiles" || value === "--format-version");
  console.error(`[build] ${label} · ${command} ${args.join(" ")}`);
  const result = await new Promise(resolve => {
    let stdout = "", error;
    const child = spawn(command, args, {...options, stdio: ["ignore", "pipe", "pipe"]});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", bytes => {
      stdout += bytes.toString();
      appendFileSync(log, bytes);
      if (!machineOutput) process.stderr.write(bytes);
      if (Buffer.byteLength(stdout) > 64 * 1024 * 1024) {
        error = new Error("build_output_exceeds_64mib");
        child.kill();
      }
    });
    child.stderr.on("data", bytes => {appendFileSync(log, bytes); process.stderr.write(bytes);});
    child.once("error", cause => {error = cause; appendFileSync(log, cause.message);});
    child.once("close", status => resolve({status, stdout, error}));
  });
  if (result.status !== 0 && machineOutput) process.stderr.write(result.stdout.slice(0, 8192));
  console.error(`[build] ${label} · exit ${result.status ?? result.error?.code ?? "unknown"} · ${((Date.now() - started) / 1000).toFixed(1)}s · ${log}`);
  return result;
}
