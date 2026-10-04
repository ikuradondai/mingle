export const groupLabels = { all: 'すべて', relationship: '恋愛・夫婦', friends: '友人', family: '家族', work: '仕事', sports: 'スポーツ', 'first-meeting': '初対面', roleplay: 'なりきり', adult: 'R18' };

// Curated relationship metadata keeps filtering useful without inspecting question copy.
export const themeGroups = {
  date: ['relationship', 'first-meeting'], couples: ['relationship'], intimacy: ['relationship'], 'new-couple': ['relationship'], 'moving-in': ['relationship'], 'first-intimacy': ['relationship'], 'intimacy-refresh': ['relationship'], 'intimacy-distance': ['relationship'], omiai: ['relationship', 'first-meeting'], 'acquaintance-date': ['relationship'],
  friends: ['friends'], reunion: ['friends'], siblings: ['family'], 'parent-50plus': ['family'], 'parent-under12': ['family'], 'family-reunion': ['family'],
  founders: ['work'], team: ['work'], 'new-colleagues': ['work'], 'sports-teammates': ['sports'],
  'party-first-meeting': ['first-meeting'], 'business-meetup': ['first-meeting', 'work'], 'bar-first-meeting': ['first-meeting'],
  'promotion-rivals': ['roleplay'], 'love-rivals': ['roleplay'], 'arch-enemies': ['roleplay'], 'hero-and-demon-king': ['roleplay'], 'assassin-and-target': ['roleplay'],
  'ex-lovers': ['roleplay'], 'detective-and-phantom-thief': ['roleplay'], 'in-laws': ['family', 'roleplay'], 'same-oshi-fans': ['friends', 'roleplay'], 'roommates': ['friends'], 'grandparents-and-grandchildren': ['family'], 'neighbors': ['first-meeting'], 'travel-companions': ['friends', 'first-meeting'], 'late-night-diner': ['friends'], 'group-mixer': ['first-meeting', 'relationship'],
};

export function isAdultGroup(deck) { return Boolean(deck?.adultOnly || deck?.r18Available || themeGroups[deck?.id]?.includes('adult')); }
