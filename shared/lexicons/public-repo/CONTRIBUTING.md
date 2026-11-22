# Contributing

Thank you for looking. Questions, problems and proposals are all welcome as issues, and concrete changes as pull
requests.

## What happens to a pull request

This repository is a copy of the lexicons kept in the unset.sh application repository
([Undefined6799/unset](https://github.com/Undefined6799/unset), under `shared/lexicons/`), where the checks run. So a
pull request here is not merged with the merge button. Instead:

1. We discuss it here.
2. If it is accepted, we make the same change in the application repository, with you as co-author of the commit
   (a `Co-authored-by` line with your GitHub name).
3. Once that is merged, the change is copied here automatically, in a commit that carries your name and links its
   source.
4. We close the pull request here with a link to that commit.

## Sign off your commits

The lexicon files are MIT, so anyone may use them. Each commit in your pull request carries a sign-off line,
`Signed-off-by: Your Name <you@example.com>`. With it you certify the
[Developer Certificate of Origin](https://developercertificate.org): the change is yours to give under that licence.
There is nothing else to sign.

- In GitHub's web editor the line is added for you.
- On your computer, commit with `git commit -s`. Forgot? `git commit --amend --no-edit -s` fixes the last commit,
  `git rebase --signoff origin/main` fixes them all; then push again with `--force-with-lease`.

When we make your change in the application repository, that commit carries your sign-off as well as your name.

## What can change

A published lexicon is close to permanent, because other apps and the records already written depend on it
([Lexicon evolution](https://atproto.com/specs/lexicon#lexicon-evolution)).

- Can be added later: a new optional field, a new block type, a new known value.
- Cannot change once published: a name, a required field, a field's type, or a size or length limit.

Until the status line in the [README](README.md) says the lexicons are published, anything may still change, and this
is the best time to say that something is wrong.

## Checking a change

The files follow the [Lexicon style guide](https://atproto.com/guides/lexicon-style-guide). With
[goat](https://github.com/bluesky-social/goat) installed, `goat lex lint` in the repository root checks them.

## Security

Please do not report a security problem in a public issue. See the application repository's
[security policy](https://github.com/Undefined6799/unset/security/policy).
