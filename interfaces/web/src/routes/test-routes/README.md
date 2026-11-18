Test-only routes (TEST_ROUTES, which only the test profile may turn on). They exist so
tests/integration/web can check the gate on the built server before the real pages land:
form-post (a form action), waits (the deadline), members (a signed-in page; members/[key] returns
to a fixed path after sign-in), writes/[key] (a page anyone reads and only members write), plain-page
(a page that runs no script) and fails (an unexpected error). Each one is refused with 404 unless
TEST_ROUTES is on.
