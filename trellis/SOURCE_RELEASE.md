# Corresponding-source release procedure

Trellis must publish the complete corresponding source for every deployed
Academy revision, including Trellis modifications, under the preserved
AGPL-3.0 notice. Publication is an Academy release gate, not a periodic upstream
sync process.

For an approved Academy release at exact Trellis commit `<commit>` and version
`<version>`:

1. Check out `<commit>` in a clean worktree.
2. Run `bun run academy:source-check` and every Academy release check.
3. Create the signed or annotated tag `academy-source/<version>` at `<commit>`.
4. Push that exact tag to the public Trellis corresponding-source repository.
5. Produce the source archive with:

   ```bash
   git archive --format=tar \
     --prefix="trellis-academy-<version>/" \
     "academy-source/<version>" trellis-academy \
     | gzip -n > "trellis-academy-<version>.tar.gz"
   ```

6. Publish the archive and its SHA-256 checksum next to the tag.
7. Link the public tag and archive from the deployed Academy About/Source page.
8. Read back the deployed revision, public tag commit, archive checksum, and
   `trellis/source-manifest.sha256`. They must all identify the same source.

Do not publish from an unreviewed branch or rebuild the archive from a different
commit. If readback differs, keep the prior verified Academy revision live and
record the mismatch as a failed release receipt.
