import { wilcoxonSignedRank } from '../bench/stats'
// classic textbook example
const a = [125,115,130,140,140,115,140,125,140,135]
const b = [110,122,125,120,140,124,123,137,135,145]
console.log(wilcoxonSignedRank(a,b))
