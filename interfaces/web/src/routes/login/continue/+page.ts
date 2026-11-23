// Nobody reads this page: it is the hop to the sign-in server, left at once by a meta refresh, and it must never wait
// for a script file. The page says so itself (book P1.22j), so it stays plain whatever the root layout's default is.
export const csr = false;
