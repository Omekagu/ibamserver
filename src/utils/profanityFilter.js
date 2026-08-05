const BANNED = [
  'fuck', 'fucker', 'fucking', 'fucked', 'shit', 'shitting', 'bitch', 'bitches',
  'asshole', 'ass', 'bastard', 'cunt', 'dick', 'pussy', 'cock', 'prick',
  'motherfucker', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'fag',
  'retard', 'moron', 'idiot', 'stupid', 'dumbass', 'dumb',
  // Nigerian slang
  'oloshi', 'ode', 'mumu', 'werey', 'agbero', 'prostitute', 'ashawo',
]

function censor (word) {
  if (word.length <= 2) return word
  return word[0] + '*'.repeat(word.length - 2) + word[word.length - 1]
}

function filterProfanity (text) {
  if (!text || typeof text !== 'string') return { clean: text, flagged: false }
  let clean = text
  let flagged = false
  for (const word of BANNED) {
    const regex = new RegExp(`\\b${word}s?\\b`, 'gi')
    if (regex.test(clean)) {
      flagged = true
      clean = clean.replace(regex, match => censor(match))
    }
  }
  return { clean, flagged }
}

module.exports = { filterProfanity }
