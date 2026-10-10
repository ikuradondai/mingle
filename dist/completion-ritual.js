import { roundCompletionInfo } from "./round-completion.js";

const STORAGE_KEY = "mingle.completion-ritual.sampler:v1";
const EMPTY_STATE = () => ({ bags: Object.create(null), last: Object.create(null), current: Object.create(null) });
const ROMANCE_IDS = new Set(["date", "acquaintance-date", "omiai", "new-couple", "couples", "moving-in", "engaged-couple", "intimacy", "first-intimacy", "intimacy-refresh", "intimacy-distance"]);
const BUSINESS_IDS = new Set(["founders", "team", "new-colleagues", "business-meetup"]);

const CANDIDATES = Object.freeze({
  group: Object.freeze([
    { id: "highfive", title: "せーので、ハイタッチ！", titleParts: ["せーので、","ハイタッチ！"], message: "顔を上げて、一緒に話した人と。", image: "/assets/ritual-highfive.webp", alt: "ハイタッチのイラスト" },
    { id: "air", title: "手を上げて、エアハイタッチ！", titleParts: ["手を上げて、","エアハイタッチ！"], message: "触れずに、気持ちをそろえて。", image: "", alt: "" },
    { id: "clap", title: "みんなで、拍手！", titleParts: ["みんなで、","拍手！"], message: "この時間を一緒につくった人へ。", image: "/assets/ritual-applause.webp", alt: "拍手のイラスト" },
    { id: "pose", title: "みんなで、小さくガッツポーズ！", titleParts: ["みんなで、","小さく","ガッツポーズ！"], message: "顔を上げて、喜びを分かち合って。", image: "/assets/ritual-solo.webp", alt: "ガッツポーズのイラスト" },
  ]),
  business: Object.freeze([
    { id: "clap", title: "この時間に、みんなで拍手！", titleParts: ["この時間に、","みんなで拍手！"], message: "一緒につくった時間へ、ぱちぱちぱち。", image: "/assets/ritual-applause.webp", alt: "拍手のイラスト" },
    { id: "oneclap", title: "せーので、一拍！", titleParts: ["せーので、","一拍！"], message: "みんなで一回、手を打とう。", image: "/assets/ritual-applause.webp", alt: "一拍のイラスト" },
    { id: "nod", title: "顔を上げて、互いに会釈。", titleParts: ["顔を上げて、","互いに会釈。"], message: "言葉の代わりに、ゆっくり伝えて。", image: "", alt: "" },
    { id: "thumbs", title: "お互いに、親指を立ててグッド！", titleParts: ["お互いに、","親指を立ててグッド！"], message: "触れずに、よかった気持ちを伝えて。", image: "", alt: "" },
  ]),
  solo: Object.freeze([
    { id: "fist", title: "自分に、よし！", titleParts: ["自分に、","よし！"], message: "こぶしをぎゅっと、小さくガッツポーズ。", image: "/assets/ritual-solo.webp", alt: "ガッツポーズのイラスト" },
    { id: "selfclap", title: "自分に、拍手を3回。", titleParts: ["自分に、","拍手を3回。"], message: "今日ここまで進んだ自分へ。", image: "", alt: "" },
    { id: "selfhug", title: "自分を、ぎゅっとひと抱き。", titleParts: ["自分を、","ぎゅっとひと抱き。"], message: "肩を包むように、そっと。", image: "", alt: "" },
    { id: "stretch", title: "両手を上げて、ぐーっと背伸び。", titleParts: ["両手を上げて、","ぐーっと背伸び。"], message: "深呼吸して、体を伸ばそう。", image: "", alt: "" },
  ]),
  romance: Object.freeze([
    { id: "gaze30", title: "30秒、見つめ合おう。", titleParts: ["30秒、","見つめ合おう。"], message: "相手の答えで、一番心に残ったものを思い浮かべながら。", note: "ふたりでよければ。", image: "/assets/ritual-gaze.webp", alt: "見つめ合うイラスト", timed: true },
    { id: "hold30", title: "30秒、手をつなごう。", titleParts: ["30秒、","手をつなごう。"], message: "相手の答えで、一番心に残ったものを思い浮かべながら。", note: "ふたりでよければ。", image: "/assets/ritual-holdhands.webp", alt: "手をつなぐイラスト", timed: true },
    { id: "smile", title: "目を合わせて、にっこり。", titleParts: ["目を合わせて、","にっこり。"], message: "相手の答えで、一番心に残ったものを思い浮かべながら。", note: "ふたりでよければ。", image: "/assets/ritual-gaze.webp", alt: "笑顔のイラスト" },
    { id: "nod", title: "相手を見て、ゆっくりうなずこう。", titleParts: ["相手を見て、","ゆっくりうなずこう。"], message: "相手の答えで、一番心に残ったものを思い浮かべながら。", note: "ふたりでよければ。", image: "", alt: "" },
  ]),
});

function storageOrNull(storage) { if (storage !== undefined) return storage; try { return globalThis.sessionStorage; } catch { return null; } }
function readStorage(storage) { try { return storage ? JSON.parse(storage.getItem(STORAGE_KEY) || "null") : null; } catch { return null; } }
function writeStorage(storage, state) { try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* memory state remains authoritative */ } }
function shuffled(ids, random) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i -= 1) {
    let value = Number(random());
    if (!Number.isFinite(value)) value = 0;
    const j = Math.max(0, Math.min(i, Math.floor(value * (i + 1))));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function validRemaining(value, ids, last) { return Array.isArray(value) && new Set(value).size === value.length && value.every((id) => ids.has(id)) && !value.includes(last); }
function cloneState(input) {
  const state = EMPTY_STATE();
  for (const key of ["bags", "last", "current"]) if (input?.[key] && typeof input[key] === "object") state[key] = { ...input[key] };
  return state;
}

export function createCompletionRitualSampler(pools = CANDIDATES, options = {}) {
  const storage = storageOrNull(options.storage);
  const random = typeof options.random === "function" ? options.random : Math.random;
  const normalized = new Map();
  for (const [context, candidates] of Object.entries(pools || {})) {
    const byId = new Map();
    for (const candidate of Array.isArray(candidates) ? candidates : []) if (candidate?.id && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
    if (byId.size) normalized.set(context, byId);
  }
  const state = cloneState(readStorage(storage));
  for (const [context, byId] of normalized) {
    const ids = new Set(byId.keys());
    const last = typeof state.last[context] === "string" && ids.has(state.last[context]) ? state.last[context] : null;
    state.last[context] = last;
    if (!validRemaining(state.bags[context], ids, last)) state.bags[context] = [];
    if (!state.current[context] || typeof state.current[context] !== "object") state.current[context] = {};
  }
  function draw(context, key = "") {
    const byId = normalized.get(context);
    if (!byId) throw new RangeError(`Unknown ritual context: ${context}`);
    const current = byId.has(state.current[context]?.[key]) ? state.current[context][key] : null;
    if (current) return byId.get(current);
    if (!state.bags[context].length) {
      state.bags[context] = shuffled([...byId.keys()], random);
      if (state.bags[context].length > 1 && state.bags[context][0] === state.last[context]) [state.bags[context][0], state.bags[context][1]] = [state.bags[context][1], state.bags[context][0]];
    }
    const id = state.bags[context].shift();
    state.last[context] = id;
    state.current[context][key] = id;
    writeStorage(storage, state);
    return byId.get(id);
  }
  return { draw, state };
}

function contextFor(session, solo = false) {
  if (solo || session?.mode === "solo" || session?.count === 1 || session?.participants?.length === 1) return "solo";
  if (session?.business === true || session?.businessSession === true || session?.mode === "business") return "business";
  const ids = Array.isArray(session?.deckIds) ? session.deckIds : session?.deckId ? [session.deckId] : [];
  if (ids.some((id) => BUSINESS_IDS.has(String(id)))) return "business";
  return ids.length > 0 && ids.every((id) => ROMANCE_IDS.has(String(id))) && session?.participants?.length === 2 ? "romance" : "group";
}

let defaultSampler;
function sampler() { if (!defaultSampler) defaultSampler = createCompletionRitualSampler(); return defaultSampler; }
export function completionRitualKey(session) { const info = roundCompletionInfo(session); const org = session?.organizationId || session?.organization_id || session?.orgId || ""; return `${org}:${info.key}`; }
export function completionRitualCandidates(context) { return CANDIDATES[context] || CANDIDATES.group; }
export function completionRitualFor(session, { solo = false } = {}) { const context = contextFor(session, solo); const key = completionRitualKey(session); const item = sampler().draw(context, key); return { ...item, context, key }; }
export function nextCompletionRitual(session, { solo = false } = {}) { const context = contextFor(session, solo); const key = completionRitualKey(session); const s = sampler(); delete s.state.current[context]?.[key]; const item = s.draw(context, key); return { ...item, context, key }; }

