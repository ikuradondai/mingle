export function resetStudioEntryState(account) {
  const isAiView = account.studioMode === "ai";
  if (isAiView) account.studioRequestId = (Number.isInteger(account.studioRequestId) ? account.studioRequestId : 0) + 1;
  account.studioMode = "list";
  account.studioAiReturnMode = "list";
  account.studioReplaceIndex = null;
  account.customEditorOpen = false;
  if (isAiView) account.busy = false;
  account.error = "";
  return account;
}
