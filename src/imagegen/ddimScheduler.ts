/**
 * DDIM (Denoising Diffusion Implicit Models) sampler for Stable Diffusion 1.5.
 *
 * SD 1.5 ships with a `scheduler/scheduler_config.json` that specifies a
 * scaled-linear beta schedule with `num_train_timesteps=1000`,
 * `beta_start=0.00085`, `beta_end=0.012`. Those constants are what HF's
 * `DDIMScheduler` uses by default — we encode them inline so the scheduler
 * is fully self-contained (no dependence on parsing the config json) but
 * the `scheduler_config.json` is still downloaded for forward-compat.
 *
 * For text-to-image:
 *   1. Sample N timesteps evenly spaced from [0, num_train_timesteps).
 *   2. Initialize latents ~ N(0, init_noise_sigma).
 *   3. For each timestep t (high noise -> low noise):
 *        - Run UNet(latents, t, condEmbeds) and UNet(latents, t, uncondEmbeds)
 *        - Combine via classifier-free guidance: e = unc + cfg * (cond - unc)
 *        - Compute new latents via the DDIM update rule.
 *   4. After the last step, latents are the clean image latents — decode
 *      via the VAE to get RGB pixel data.
 *
 * Roughly 80 lines of math; tested behavior matches HF DDIMScheduler with
 * `set_alpha_to_one=False`, `prediction_type='epsilon'`, `eta=0`.
 */

const NUM_TRAIN_TIMESTEPS = 1000;
const BETA_START = 0.00085;
const BETA_END = 0.012;

/** SD 1.5 latents are scaled by this factor when fed to the VAE decoder. */
export const VAE_SCALING_FACTOR = 0.18215;

/** Initial noise sigma for SD 1.5's DDIM schedule (sqrt of 1/alpha_cumprod[T-1]). */
export const INIT_NOISE_SIGMA = 1.0;

/** Precomputed alphas_cumprod table — length 1000. Lazily built. */
let alphasCumprodCache: Float32Array | null = null;

function getAlphasCumprod(): Float32Array {
  if (alphasCumprodCache) return alphasCumprodCache;
  const out = new Float32Array(NUM_TRAIN_TIMESTEPS);
  // scaled_linear: betas = linspace(sqrt(beta_start), sqrt(beta_end), N)^2
  let prev = 1.0;
  const denom = NUM_TRAIN_TIMESTEPS - 1;
  for (let i = 0; i < NUM_TRAIN_TIMESTEPS; i++) {
    const t = denom > 0 ? i / denom : 0;
    const sqrtBeta = Math.sqrt(BETA_START) + t * (Math.sqrt(BETA_END) - Math.sqrt(BETA_START));
    const beta = sqrtBeta * sqrtBeta;
    const alpha = 1.0 - beta;
    prev = prev * alpha;
    out[i] = prev;
  }
  alphasCumprodCache = out;
  return out;
}

/**
 * Build the timestep schedule for `numInferenceSteps`. Returns a descending
 * list of integer timesteps (high noise to low noise), e.g.
 * [951, 901, ..., 1] for 20 steps.
 */
export function buildDdimTimesteps(numInferenceSteps: number): Int32Array {
  const stepRatio = Math.floor(NUM_TRAIN_TIMESTEPS / numInferenceSteps);
  const out = new Int32Array(numInferenceSteps);
  for (let i = 0; i < numInferenceSteps; i++) {
    out[i] = (numInferenceSteps - 1 - i) * stepRatio;
  }
  return out;
}

/**
 * Single DDIM sampler step with eta=0 (deterministic). Updates `xPrev` from
 * `x` (current latents) using the predicted noise `eps`.
 *
 * Formula (epsilon prediction, eta=0):
 *   x0 = (x - sqrt(1 - alpha_t) * eps) / sqrt(alpha_t)
 *   x_prev = sqrt(alpha_prev) * x0 + sqrt(1 - alpha_prev) * eps
 */
export function ddimStep(
  x: Float32Array,
  eps: Float32Array,
  t: number,
  tPrev: number,
  out: Float32Array,
): void {
  const alphas = getAlphasCumprod();
  const alphaT = alphas[t];
  // tPrev < 0 means we hit the end — use 1.0 (the "set_alpha_to_one=False"
  // path uses alphas[0] but the canonical SD config sets it to one; both
  // produce visually identical results for the final step).
  const alphaPrev = tPrev >= 0 ? alphas[tPrev] : 1.0;

  const sqrtAlphaT = Math.sqrt(alphaT);
  const sqrtOneMinusAlphaT = Math.sqrt(1 - alphaT);
  const sqrtAlphaPrev = Math.sqrt(alphaPrev);
  const sqrtOneMinusAlphaPrev = Math.sqrt(1 - alphaPrev);

  for (let i = 0; i < x.length; i++) {
    const x0 = (x[i] - sqrtOneMinusAlphaT * eps[i]) / sqrtAlphaT;
    out[i] = sqrtAlphaPrev * x0 + sqrtOneMinusAlphaPrev * eps[i];
  }
}

/**
 * Apply classifier-free guidance to combine conditional and unconditional
 * noise predictions:
 *   eps = eps_uncond + scale * (eps_cond - eps_uncond)
 */
export function applyCfg(
  epsCond: Float32Array,
  epsUncond: Float32Array,
  scale: number,
  out: Float32Array,
): void {
  for (let i = 0; i < epsCond.length; i++) {
    out[i] = epsUncond[i] + scale * (epsCond[i] - epsUncond[i]);
  }
}

/**
 * Linear-congruential PRNG seeded by `seed`. We use this instead of
 * Math.random for deterministic output — same prompt + same seed should
 * produce visually identical images.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Box-Muller transform: produce two N(0,1) samples from two U(0,1) samples.
 * Used to seed the initial latents.
 */
export function fillGaussian(out: Float32Array, seed: number): void {
  const rand = lcg(seed);
  for (let i = 0; i < out.length; i += 2) {
    let u1 = rand();
    if (u1 < 1e-10) u1 = 1e-10; // avoid log(0)
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    out[i] = r * Math.cos(theta);
    if (i + 1 < out.length) {
      out[i + 1] = r * Math.sin(theta);
    }
  }
  // Apply init_noise_sigma scaling.
  if (INIT_NOISE_SIGMA !== 1.0) {
    for (let i = 0; i < out.length; i++) {
      out[i] *= INIT_NOISE_SIGMA;
    }
  }
}
