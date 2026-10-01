// 課金導入時は、この境界でサーバー検証済みの権限に差し替える。
export async function canContinue() {
  return true;
}
