/**
 * How long lists draw on a phone. React Native's defaults draw ~10 screens of rows around the one
 * you see and 10 rows per batch; framed posts with faces and photos are heavy, so that made the
 * first screen late and fast scrolling stutter. These draw what fits a screen first, then a few
 * screens around it, in small batches. Spread into every FlatList of posts or people.
 */
export const LIST_PERF = {
  initialNumToRender: 4,
  maxToRenderPerBatch: 4,
  updateCellsBatchingPeriod: 40,
  windowSize: 7,
  removeClippedSubviews: true,
} as const;
