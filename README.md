# AI Fund data

This branch holds the state of the Installous AI Fund (`fund.json`): its cash,
positions, trade log and daily value history. The **Deploy demo** workflow on
`main` updates it on every run, so it's written by automation. Don't edit it by hand.

Deleting `fund.json` restarts the fund from $100,000 on the next run.
