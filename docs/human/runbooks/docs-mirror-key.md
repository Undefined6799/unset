# The docs mirror and its deploy key

`.github/workflows/docs-mirror.yml` copies this repository's human docs (`docs/human` and `docs/site`) to the docs
repository, [unset-sh/docs](https://github.com/unset-sh/docs), where every repository's docs are gathered and from
which docs.unset.sh is built (ADR 0092). It pushes with a deploy key: an SSH key pair whose public half is on the docs
repository and whose private half is the secret `DOCS_DEPLOY_KEY` of the `docs-mirror` environment here. Only Alex
makes and places the key. Never paste the private half anywhere but the secret field, and never give it to an agent.

**Who:** Alex.

## Set up (once)
1. Create `unset-sh/docs`: public, with "Add a README file" ticked, no licence, no `.gitignore`. The copy cannot read
   a repository with no commit, and its first run replaces that README with ours.
2. Allow deploy keys in the organisation, if the lexicons mirror has not already: profile picture, Organizations,
   unset-sh, Settings, Member privileges, "Deploy keys", Enabled, Save.
3. Add no branch protection or ruleset to `unset-sh/docs` that would refuse a deploy key's push to its default
   branch: the copy pushes there directly, with no pull request.
4. Make the pair on your own machine, without a passphrase (the workflow cannot type one):
   `ssh-keygen -t ed25519 -N "" -C "unset docs mirror" -f ~/docsmirror`
5. Public half (`~/docsmirror.pub`): on unset-sh/docs open Settings, Deploy keys, Add deploy key, title
   `Undefined6799/unset docs-mirror`, paste it, tick "Allow write access", Add key.
6. Private half (`~/docsmirror`): on Undefined6799/unset open Settings, Environments, New environment, name
   `docs-mirror`, Configure environment. Under "Deployment branches and tags" choose "Selected branches and tags" and
   add the branch `main`. Add no required reviewers. Under "Environment secrets" add `DOCS_DEPLOY_KEY` with the file's
   whole content. It must be an environment secret: a repository secret can be read by a workflow on any branch.
7. Delete both files and clear the clipboard: `rm ~/docsmirror ~/docsmirror.pub && pbcopy < /dev/null`.

Every push to main that changes `docs/human` or `docs/site` starts a copy, and so does the merge that adds the
workflow. A run that failed for a missing key or repository changed nothing: once the steps above are done, re-run it
from the Actions tab.

## Check
The Actions tab shows a green `docs-mirror` run whose summary says "Pushed". On unset-sh/docs the newest commit is
"Copy the docs from Undefined6799/unset@…", it links the commit here, and `unset/site/hugo.yaml` exists.

## Another repository joins
Each source repository gets its own key pair, so one can be cut off without the others: repeat steps 4 to 7 with a
new pair, the public half on unset-sh/docs under that repository's name, the private half in that repository's own
`docs-mirror` environment. Its workflow replaces only the folder named after it.

Its folder becomes a section of docs.unset.sh under the folder's name (`deployment/docs-repo/site.yml`). The folder
is Hugo content: an `_index.md` at its top whose front matter gives `title`, `type: docs` with `cascade: { type: docs }`,
and, to appear in the top bar, a `menus: { main: { weight: N } }` entry; links between its pages are relative, so they
also work on GitHub. A folder named like a section the site already has, or one holding a link, fails the site build.
Add the folder to the table in `deployment/docs-repo/README.md`.

## Rotate
Repeat steps 4 to 7 with a new pair, replacing the secret's value, then delete the old deploy key on unset-sh/docs.
Rotate when anyone who could read the private half should no longer, and after any doubt.

## Cut off (a leak, or anything odd in the docs repository)
1. Delete the deploy key on unset-sh/docs (Settings, Deploy keys). It stops working at once.
2. Compare `unset/`, `README.md` and `.github/` there with `node scripts/ci/docs-export.ts <new folder>` run on main
   here, and look at the other folders' history: a deploy key can write any file of that repository. If the history
   was rewritten, restore it by hand as an owner of the organisation.
3. Set up a new key. The next copy puts this repository's files back.

## When a run fails
- "refused the push three times": the docs repository did not accept the push. Check that the deploy key is there
  with write access and that nothing restricts pushes to the default branch (step 3), then re-run.
- A failed rebase ("could not apply"): someone changed `unset/`, `README.md` or `.github/` in the docs repository by
  hand. Nothing was pushed. Revert that commit there, then re-run; the change belongs in this repository.
