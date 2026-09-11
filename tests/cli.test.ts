import { expect, test } from "bun:test";
import { encodeWav } from "../src/audio/wav";
import type { AudioBuffer } from "../src/types";

const SR = 44100;
const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
const TMP = new URL("./tmp/", import.meta.url).pathname;

/**
 * Build a tonal test signal with an amplitude envelope.
 *
 * The signal sums three sine tones and applies a slow envelope. Five seconds
 * gives the perceptual watermarker more than one block to detect.
 *
 * @param seconds - the length of the signal, in seconds.
 * @returns a one-channel audio buffer.
 */
function tone(seconds: number): AudioBuffer {
  const n = Math.floor(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t);
    x[i] =
      env *
      0.3 *
      (Math.sin(2 * Math.PI * 220 * t) +
        0.5 * Math.sin(2 * Math.PI * 660 * t) +
        0.25 * Math.sin(2 * Math.PI * 1500 * t));
  }
  return { sampleRate: SR, channels: [x] };
}

/** Run the CLI as a child process and collect its output and exit code. */
async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function writeFixture(name: string, audio: AudioBuffer): Promise<string> {
  const path = `${TMP}${name}`;
  await Bun.write(path, encodeWav(audio));
  return path;
}

test("embed then detect recovers the id", async () => {
  const input = await writeFixture("embed-input.wav", tone(5));
  const output = `${TMP}embed-output.wav`;

  const embed = await runCli(["embed", input, "-o", output, "--id", "0x2a", "--key", "k1", "--json"]);
  expect(embed.exitCode).toBe(0);
  const embedResult = JSON.parse(embed.stdout);
  expect(embedResult.id).toBe("42");
  expect(embedResult.detected).toBe(true);
  expect(embedResult.recoveredId).toBe(embedResult.id);

  const detect = await runCli(["detect", output, "--key", "k1", "--json"]);
  expect(detect.exitCode).toBe(0);
  const detectResult = JSON.parse(detect.stdout);
  expect(detectResult.detected).toBe(true);
  expect(detectResult.id).toBe("42");
});

test("embed without --id generates a random id and reports it", async () => {
  const input = await writeFixture("embed-random-input.wav", tone(5));
  const output = `${TMP}embed-random-output.wav`;

  const embed = await runCli(["embed", input, "-o", output, "--key", "k2", "--json"]);
  expect(embed.exitCode).toBe(0);
  const embedResult = JSON.parse(embed.stdout);
  expect(embedResult.generatedId).toBe(true);
  expect(typeof embedResult.id).toBe("string");

  const detect = await runCli(["detect", output, "--key", "k2", "--json"]);
  const detectResult = JSON.parse(detect.stdout);
  expect(detectResult.id).toBe(embedResult.id);
});

test("metrics --json output parses as JSON", async () => {
  const input = await writeFixture("metrics-input.wav", tone(5));
  const output = `${TMP}metrics-output.wav`;
  await runCli(["embed", input, "-o", output, "--id", "7", "--key", "k3"]);

  const metrics = await runCli(["metrics", input, output, "--json"]);
  expect(metrics.exitCode).toBe(0);
  const parsed = JSON.parse(metrics.stdout);
  expect(typeof parsed.snr).toBe("number");
  expect(typeof parsed.mse).toBe("number");
  expect(typeof parsed.psnr).toBe("number");
});

test("detect on clean unwatermarked audio exits 2", async () => {
  const input = await writeFixture("clean.wav", tone(5));
  const detect = await runCli(["detect", input, "--key", "k4", "--json"]);
  expect(detect.exitCode).toBe(2);
  const parsed = JSON.parse(detect.stdout);
  expect(parsed.detected).toBe(false);
});

test("a missing input file exits 1", async () => {
  const detect = await runCli(["detect", `${TMP}does-not-exist.wav`]);
  expect(detect.exitCode).toBe(1);
  expect(detect.stderr.length).toBeGreaterThan(0);
});
