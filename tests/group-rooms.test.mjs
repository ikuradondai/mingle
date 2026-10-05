import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';

const owner = '11111111-1111-4111-8111-111111111111';
const roomId = '22222222-2222-4222-8222-222222222222';
const hostMemberId = '33333333-3333-4333-8333-333333333333';
const guestMemberId = '44444444-4444-4444-8444-444444444444';
const cards = Array.from({ length: 12 }, (_, i) => ({ id: `date-${String(i + 1).padStart(2, '0')}`, text: `Q${i + 1}`, r18: false }));
const room = { id: roomId, host_user_id: owner, invite_hash: '', deck_id: 'date', deck_name: '初対面の初デート', cards, adult_only: false, status: 'lobby', member_count: 1, cursor: 0, revealed: false, answer_index: 0, revision: 0, expires_at: '2099-01-01T00:00:00.000Z' };
const hostMember = { id: hostMemberId, room_id: roomId, display_name: '代表者', role: 'host', adult_confirmed: true, joined_at: '2026-01-01T00:00:00.000Z' };
const guestMember = { id: guestMemberId, room_id: roomId, display_name: '友だち', role: 'guest', adult_confirmed: true, joined_at: '2026-01-01T00:00:01.000Z' };

function fixture({ confirmed = true } = {}) {
  const state = { confirmed, createBody: null, joinBody: null, stripGuestAge: false };
  let guest = guestMember;
  const current = structuredClone(room);
  Object.assign(current, { invite_hash: '', status: 'lobby', member_count: 1, cursor: 0, revealed: false, answer_index: 0, revision: 0, expires_at: '2099-01-01T00:00:00.000Z' });
  const seen = [];
  let inviteHash;
  let guestSecretHash;
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const path = u.pathname; const method = options.method || 'GET';
    seen.push({ url, method, headers: options.headers || {} });
    if (path === '/auth/v1/user') {
      if (options.headers?.Authorization === 'Bearer anon') return new Response(JSON.stringify({ id: owner, is_anonymous: true }), { status: 200 });
      if (options.headers?.Authorization !== 'Bearer jwt-owner') return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ id: owner, is_anonymous: false }), { status: 200 });
    }
    if (method === 'DELETE' && path === '/rest/v1/group_rooms') return new Response('[]', { status: 200 });
    if (method === 'POST' && path === '/rest/v1/rpc/group_create_room') {
      const body = JSON.parse(options.body); state.createBody = body; if (body.p_adult_only && !body.p_adult_attested) return new Response(JSON.stringify({ message: 'ADULT_ATTESTATION_REQUIRED' }), { status: 400 }); current.adult_attested_at = body.p_adult_only ? '2026-01-01T00:00:00+00:00' : null; inviteHash = body.p_invite_hash; current.invite_hash = inviteHash; current.cards = body.p_cards; current.adult_only = body.p_adult_only; current.deck_id = body.p_deck_id; current.deck_name = body.p_deck_name;
      return new Response(JSON.stringify([{ room_id: roomId, host_member_id: hostMemberId }]), { status: 200 });
    }
    if (method === 'POST' && path === '/rest/v1/rpc/group_join_member') {
      const payload = JSON.parse(options.body); state.joinBody = payload;
      if (guestSecretHash === payload.p_secret_hash) return new Response(JSON.stringify([{ ...guest }]), { status: 200 });
      if (current.adult_only && payload.p_age_confirmed !== true) return new Response(JSON.stringify({ message: 'PARTICIPANT_AGE_REQUIRED' }), { status: 400 });
      guest = { ...guestMember, adult_confirmed: payload.p_adult_confirmed, age_confirmed_at: payload.p_age_confirmed ? '2026-01-01T00:00:02.000Z' : null };
      guestSecretHash = payload.p_secret_hash; current.member_count = 2; current.revision += 1; return new Response(JSON.stringify([{ ...guest }]), { status: 200 });
    }
    if (path === '/rest/v1/group_rooms') {
      if (method === 'PATCH') {
        const body = JSON.parse(options.body);
        if (Number((u.searchParams.get('revision') || '').replace(/^eq\./, '')) !== current.revision) return new Response('[]', { status: 200 });
        Object.assign(current, body); return new Response(JSON.stringify([{ ...current }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ ...current }]), { status: 200 });
    }
    if (path === '/rest/v1/group_members') {
      const hostRow = current.adult_only ? { ...hostMember, age_confirmed_at: '2026-01-01T00:00:00.000Z' } : hostMember; const guestRow = state.stripGuestAge ? { ...guest, age_confirmed_at: null } : guest; const rows = current.member_count > 1 ? [hostRow, guestRow] : [hostRow];
      if (u.searchParams.has('id')) return new Response(JSON.stringify([hostRow]), { status: 200 });
      if (u.searchParams.has('secret_hash')) return new Response(u.searchParams.get('secret_hash') === `eq.${guestSecretHash}` ? JSON.stringify([guest]) : '[]', { status: 200 });
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (path === '/rest/v1/account_profiles') return new Response(JSON.stringify(state.confirmed && u.searchParams.get('user_id') === `eq.${owner}` ? [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }] : []), { status: 200 });
    if (path === '/rest/v1/my_sets') {
      if (u.searchParams.get('user_id') !== `eq.${owner}`) return new Response('[]', { status: 200 });
      return new Response(JSON.stringify([{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '自分セット', card_ids: cards.slice(0, 6).map((card) => card.id) }]), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
  return { service: createGroupRoomService({ env: { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service', }, fetchImpl, now: () => Date.parse('2026-01-01T00:00:00Z') }), seen, state };
}
const req = (body = {}, headers = { authorization: 'Bearer jwt-owner' }) => ({ body, headers, url: 'http://localhost/api/group' });

test('anonymous host is rejected and DB requests use service bearer', async () => {
  const { service } = fixture();
  await assert.rejects(() => service.create({ body: { deckId: 'date' }, headers: { authorization: 'Bearer anon' } }), (e) => e.code === 'UNAUTHENTICATED');
});
test('host create, guest join, projection and CAS answer progression', async () => {
  const { service, seen } = fixture();
  const created = await service.create(req({ deckId: 'date', hostName: '代表者' }));
  assert.equal(created.host, true);
  assert.equal(created.room.members.length, 1);
  const joined = await service.join({ body: { inviteToken: created.inviteToken, name: '友だち' }, headers: {} }, roomId);
  assert.equal(joined.room.members.length, 2);
  const hostState = await service.state(req(), roomId);
  assert.equal(hostState.card, null);
  const started = await service.action(req({ action: 'start', revision: joined.room.revision }), roomId);
  const revealed = await service.action(req({ action: 'reveal', revision: started.room.revision }), roomId);
  assert.ok(revealed.card?.id);
  const guestState = await service.state({ headers: { 'x-group-member-token': joined.memberToken }, url: 'http://localhost/api/group' }, roomId);
  assert.equal(guestState.card.id, revealed.card.id);
  assert.equal(guestState.room.speakerName, '代表者');
  assert.ok(seen.filter((entry) => entry.url.includes('/rest/v1/')).every((entry) => entry.headers.Authorization === 'Bearer service'));
  const secondSpeaker = await service.action(req({ action: 'next', revision: revealed.room.revision }), roomId);
  assert.equal(secondSpeaker.room.answerIndex, 1);
  const guestAfterSpeaker = await service.state({ headers: { 'x-group-member-token': joined.memberToken }, url: 'http://localhost/api/group' }, roomId);
  assert.equal(guestAfterSpeaker.room.speakerName, '友だち');
});

test('unknown member and guest mutation are denied, stale CAS wins once', async () => {
  const { service } = fixture();
  const created = await service.create(req({ deckId: 'date' }));
  const joined = await service.join({ body: { inviteToken: created.inviteToken, name: 'Guest' }, headers: {} }, roomId);
  await assert.rejects(() => service.state({ headers: { 'x-group-member-token': 'wrong-secret' }, url: 'http://localhost/api/group' }, roomId), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => service.action({ body: { action: 'start', revision: 0 }, headers: {} }, roomId), (e) => e.code === 'UNAUTHENTICATED');
  const started = await service.action(req({ action: 'start', revision: joined.room.revision }), roomId);
  await assert.rejects(() => service.action(req({ action: 'reveal', revision: started.room.revision - 1 }), roomId), (e) => e.code === 'GROUP_STALE');
});

test('repeating a join with the same member secret is idempotent', async () => {
  const { service } = fixture();
  const created = await service.create(req({ deckId: 'date' }));
  const memberSecret = 'A'.repeat(43);
  const first = await service.join({ body: { inviteToken: created.inviteToken, name: '再接続', memberSecret }, headers: {} }, roomId);
  const second = await service.join({ body: { inviteToken: created.inviteToken, name: '再接続', memberSecret }, headers: {} }, roomId);
  assert.equal(second.member.id, first.member.id);
  assert.equal(second.room.memberCount, first.room.memberCount);
  assert.equal(second.room.revision, first.room.revision);
});

test('owner myset is resolved server-side and R18 consent is required', async () => {
  const { service } = fixture();
  const set = await service.create(req({ setId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
  assert.equal(set.room.total, 6);
  await assert.rejects(() => service.create(req({ deckId: 'date', includeR18: true, participantsAdultAttested: true })), (e) => e.code === 'ADULT_CONSENT_REQUIRED' && e.status === 403);
  const adult = await service.create(req({ deckId: 'date', includeR18: true, adultConfirmed: true, participantsAdultAttested: true }));
  assert.equal(adult.room.adultOnly, true);
});

test('two-member answer turns reach a hidden six-card break and continue', async () => {
  const { service } = fixture();
  const created = await service.create(req({ deckId: 'date' }));
  const joined = await service.join({ body: { inviteToken: created.inviteToken, name: 'Guest' }, headers: {} }, roomId);
  let current = await service.action(req({ action: 'start', revision: joined.room.revision }), roomId);
  for (let card = 0; card < 6; card += 1) {
    current = await service.action(req({ action: 'reveal', revision: current.room.revision }), roomId);
    current = await service.action(req({ action: 'next', revision: current.room.revision }), roomId);
    current = await service.action(req({ action: 'next', revision: current.room.revision }), roomId);
  }
  assert.equal(current.room.status, 'break');
  assert.equal(current.card, null);
  const resumed = await service.action(req({ action: 'continue', revision: current.room.revision }), roomId);
  assert.equal(resumed.room.status, 'playing');
  assert.equal(resumed.card, null);
});

test('R18 room creation needs login, a confirmed account, host attestation, then consent (in that order)', async () => {
  const unconfirmed = fixture({ confirmed: false });
  await assert.rejects(() => unconfirmed.service.create({ body: { deckId: 'intimacy', adultConfirmed: true, participantsAdultAttested: true }, headers: {} }), (e) => e.status === 401 && e.code === 'UNAUTHENTICATED');
  await assert.rejects(() => unconfirmed.service.create(req({ deckId: 'intimacy', adultConfirmed: true, participantsAdultAttested: true })), (e) => e.status === 403 && e.code === 'AGE_CONFIRMATION_REQUIRED');
  await assert.rejects(() => unconfirmed.service.create(req({ deckId: 'date', includeR18: true, adultConfirmed: true, participantsAdultAttested: true })), (e) => e.status === 403 && e.code === 'AGE_CONFIRMATION_REQUIRED');
  assert.equal(unconfirmed.state.createBody, null);
  const { service, state } = fixture();
  await assert.rejects(() => service.create(req({ deckId: 'intimacy', adultConfirmed: true })), (e) => e.status === 403 && e.code === 'ADULT_ATTESTATION_REQUIRED');
  await assert.rejects(() => service.create(req({ deckId: 'intimacy', adultConfirmed: true, participantsAdultAttested: false })), (e) => e.status === 403 && e.code === 'ADULT_ATTESTATION_REQUIRED');
  await assert.rejects(() => service.create(req({ deckId: 'intimacy', adultConfirmed: true, participantsAdultAttested: 'yes' })), (e) => e.status === 400 && e.code === 'INVALID_REQUEST');
  await assert.rejects(() => service.create(req({ deckId: 'intimacy', participantsAdultAttested: true })), (e) => e.status === 403 && e.code === 'ADULT_CONSENT_REQUIRED');
  assert.equal(state.createBody, null);
  const created = await service.create(req({ deckId: 'intimacy', adultConfirmed: true, participantsAdultAttested: true }));
  assert.equal(created.room.adultOnly, true);
  assert.equal(created.room.adultAttestedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(created.room.members[0].ageConfirmed, true);
  assert.equal(state.createBody.p_adult_attested, true);
  assert.equal(state.createBody.p_adult_only, true);
});

test('non-R18 rooms ignore the attestation flag and need no account confirmation', async () => {
  const { service, state } = fixture({ confirmed: false });
  const created = await service.create(req({ deckId: 'date', participantsAdultAttested: true }));
  assert.equal(created.room.adultOnly, false);
  assert.equal(created.room.adultAttestedAt, null);
  assert.equal(state.createBody.p_adult_attested, false);
});

test('R18 room preview hides the theme name; join needs the age tap and consent; start needs every member', async () => {
  const { service, state } = fixture();
  const created = await service.create(req({ deckId: 'intimacy', adultConfirmed: true, participantsAdultAttested: true }));
  const preview = await service.preview({ body: { inviteToken: created.inviteToken }, headers: {} }, roomId);
  assert.equal(preview.room.deckName, null);
  assert.equal(preview.room.deckId, null);
  assert.equal(preview.room.adultOnly, true);
  assert.equal(preview.room.adultAttestedAt, '2026-01-01T00:00:00.000Z');
  await assert.rejects(() => service.join({ body: { inviteToken: created.inviteToken, name: '友だち', adultConfirmed: true }, headers: {} }, roomId), (e) => e.status === 403 && e.code === 'PARTICIPANT_AGE_REQUIRED');
  await assert.rejects(() => service.join({ body: { inviteToken: created.inviteToken, name: '友だち', ageConfirmed: true }, headers: {} }, roomId), (e) => e.status === 403 && e.code === 'ADULT_CONSENT_REQUIRED');
  await assert.rejects(() => service.join({ body: { inviteToken: created.inviteToken, name: '友だち', ageConfirmed: 'true', adultConfirmed: true }, headers: {} }, roomId), (e) => e.status === 400 && e.code === 'INVALID_REQUEST');
  assert.equal(state.joinBody, null);
  const joined = await service.join({ body: { inviteToken: created.inviteToken, name: '友だち', ageConfirmed: true, adultConfirmed: true }, headers: {} }, roomId);
  assert.equal(state.joinBody.p_age_confirmed, true);
  assert.equal(state.joinBody.p_adult_confirmed, true);
  assert.equal(joined.member.ageConfirmed, true);
  assert.equal(joined.room.adultAttestedAt, '2026-01-01T00:00:00.000Z');
  assert.ok(joined.room.members.every((member) => member.ageConfirmed === true));
  const started = await service.action(req({ action: 'start', revision: joined.room.revision }), roomId);
  assert.equal(started.room.status, 'playing');
});

test('R18 room start is refused while a member has no recorded age tap', async () => {
  const { service, state } = fixture();
  const created = await service.create(req({ deckId: 'intimacy', adultConfirmed: true, participantsAdultAttested: true }));
  const joined = await service.join({ body: { inviteToken: created.inviteToken, name: '友だち', ageConfirmed: true, adultConfirmed: true }, headers: {} }, roomId);
  state.stripGuestAge = true;
  await assert.rejects(() => service.action(req({ action: 'start', revision: joined.room.revision }), roomId), (e) => e.status === 403 && e.code === 'PARTICIPANT_AGE_REQUIRED');
});

test('non-R18 rooms need no login, age tap or consent to join and keep the theme name in the preview', async () => {
  const { service, state } = fixture({ confirmed: false });
  const created = await service.create(req({ deckId: 'date' }));
  const preview = await service.preview({ body: { inviteToken: created.inviteToken }, headers: {} }, roomId);
  assert.equal(preview.room.deckName, '初対面の初デート');
  assert.notEqual(preview.room.deckId, null);
  const joined = await service.join({ body: { inviteToken: created.inviteToken, name: '友だち' }, headers: {} }, roomId);
  assert.equal(joined.member.ageConfirmed, false);
  assert.equal(state.joinBody.p_age_confirmed, false);
});
