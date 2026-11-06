export default {
  post: (result: { projectKey: string; expiresAt: string; sessionBinding: string; user: { id: string } }) =>
    (result.projectKey === 'tendentia' && Number.isFinite(Date.parse(result.expiresAt)) &&
      /^[A-Za-z0-9_-]{43}$/.test(result.sessionBinding) && Boolean(result.user.id)) || 'Invalid scoped binding',
};
