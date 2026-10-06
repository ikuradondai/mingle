import test from "node:test";
import assert from "node:assert/strict";
import { buildFacebookShareUrl, buildShareText, buildXShareUrl, SHARE_URL } from "../dist/share-text.js";

test("share text keeps the title, hashtags, and official URL in one payload", () => {
  const text = buildShareText("友人と、もう一歩・初対面の初デート");
  assert.match(text, /^ミングルで、「友人と、もう一歩・初対面の初デート」の会話やってみた！/);
  assert.match(text, /#Minglecards #あたらしい会話のはじめかた/);
  assert.equal(text.endsWith(SHARE_URL), true);
  assert.equal(text.includes("参加者"), false);
});

test("X and Facebook routes contain only the fixed official share URL", () => {
  const text = buildShareText("マイセット");
  const x = new URL(buildXShareUrl(text));
  assert.equal(x.origin, "https://twitter.com");
  assert.equal(x.pathname, "/intent/tweet");
  assert.equal(x.searchParams.get("text"), text.slice(0, -SHARE_URL.length).trimEnd());
  assert.equal(x.searchParams.getAll("url").length, 1);
  assert.equal(x.searchParams.get("url"), SHARE_URL);
  assert.equal((x.searchParams.get("text").match(/#Minglecards/g) || []).length, 1);
  const facebook = new URL(buildFacebookShareUrl());
  assert.equal(facebook.origin, "https://www.facebook.com");
  assert.equal(facebook.pathname, "/sharer/sharer.php");
  assert.equal(facebook.searchParams.get("u"), SHARE_URL);
});
