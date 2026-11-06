export default {
  post: (result: { userId: string; expiresAt: number } | null) =>
    result === null || (Boolean(result.userId) && Number.isFinite(result.expiresAt)) || 'Invalid local owner',
};
