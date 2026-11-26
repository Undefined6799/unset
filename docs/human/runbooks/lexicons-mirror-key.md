# The lexicons mirror and its deploy key

`.github/workflows/lexicons-mirror.yml` copies our lexicons to the public repository
[unset-sh/lexicons](https://github.com/unset-sh/lexicons) (ADR 0089). It pushes with a deploy key: an SSH key pair
whose public half is on that repository and whose private half is the secret `LEXICONS_DEPLOY_KEY` of the
`lexicons-mirror` environment here. Only Alex makes and places the key. Never paste the private half anywhere but the
secret field, and never give it to an agent.

## Set up (once)
1. Create `unset-sh/lexicons`: public, with "Add a README file" ticked. The copy cannot read a repository with no
   commit.
2. Allow deploy keys in the organisation, which new organisations do not: profile picture, Organizations, unset-sh,
   Settings, Member privileges, "Deploy keys", Enabled, Save.
3. Make the pair on your own machine, without a passphrase (the workflow cannot type one):
   `ssh-keygen -t ed25519 -N "" -C "unset lexicons mirror" -f ~/lexmirror`
4. Public half (`~/lexmirror.pub`): on unset-sh/lexicons open Settings, Deploy keys, Add deploy key, paste it, tick
   "Allow write access", Add key.
5. Private half (`~/lexmirror`): on Undefined6799/unset open Settings, Environments, New environment, name
   `lexicons-mirror`, Configure environment. Under "Deployment branches and tags" choose "Selected branches and tags"
   and add the branch `main`. Under "Environment secrets" add `LEXICONS_DEPLOY_KEY` with the file's whole content.
   It must be an environment secret: a repository secret can be read by a workflow on any branch.
6. Delete both files and clear the clipboard: `rm ~/lexmirror ~/lexmirror.pub && pbcopy < /dev/null`.

The next push to main that changes a lexicon makes the first copy. A run that failed for a missing key or repository
can be re-run from the Actions tab once the steps above are done.

## Rotate
Repeat steps 3 to 6 with a new pair, replacing the secret's value, then delete the old deploy key on
unset-sh/lexicons. Rotate when anyone who could read the private half should no longer, and after any doubt.

## Cut off (a leak, or anything odd in the public repository)
1. Delete the deploy key on unset-sh/lexicons (Settings, Deploy keys). It stops working at once.
2. Compare the public repository with `node scripts/ci/lexicons-export.ts <new folder>` run on main. If its
   history was rewritten, restore it by hand as an owner of the organisation.
3. Set up a new key. The next copy puts the right files back.

What apps resolve is not affected by any of this: a published lexicon lives in the lexicon account's repository,
found through DNS, never on GitHub.

## Bringing a contribution across
1. Discuss the issue or pull request on unset-sh/lexicons.
2. Make the accepted change here, in `shared/lexicons/schemas/`, in a commit that ends with
   `Co-authored-by: <name> <id+login@users.noreply.github.com>` for the contributor.
3. Land it through the usual pull request and checks. The merge triggers the copy, whose commit carries the trailer.
4. Close the public pull request with a link to that commit. Never use the merge button there: the next copy would
   replace it.
