export const groupLabels = { all: 'すべて', relationship: '恋愛・夫婦', friends: '友人', family: '家族', work: '仕事', sports: 'スポーツ', adult: 'R18' };

// Curated relationship metadata keeps filtering useful without inspecting question copy.
export const themeGroups = {
  date: ['relationship'], couples: ['relationship'], intimacy: ['relationship'], 'new-couple': ['relationship'], 'moving-in': ['relationship'], 'first-intimacy': ['relationship'], 'intimacy-refresh': ['relationship'], 'intimacy-distance': ['relationship'], omiai: ['relationship'],
  friends: ['friends'], reunion: ['friends'], siblings: ['family', 'friends'], 'parent-50plus': ['family'], 'parent-under12': ['family'], 'family-reunion': ['family'],
  founders: ['work'], team: ['work'], 'new-colleagues': ['work'], 'sports-teammates': ['sports'],
};

export function isAdultGroup(deck) { return Boolean(deck?.adultOnly || deck?.r18Available || themeGroups[deck?.id]?.includes('adult')); }
