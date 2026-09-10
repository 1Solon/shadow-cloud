# Save-Derived Events: Shadow Empire Manual Research

Research date: 2026-09-10.

## Source And Scope

Primary source: Matrix Games' official [Shadow Empire manual, EBOOK PDF](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf). Page references below are the printed page numbers, which also match the PDF page positions in this 369-page file. The PDF metadata dates its creation to 2021-04-19; this is evidence for that manual, not verification of every subsequent game release. Short quotations were checked in its extracted text.

This note supports a design interview about game events inferred from saves. It follows the vocabulary in [`CONTEXT.md`](../CONTEXT.md): a **Seat** belongs to a Shadow Cloud campaign's turn order; a **Regime** is an in-game nation; a **Regime association** links the two. Regime elimination is distinct from a player resigning from a campaign. No ADR files were present. Existing technical notes live directly in `docs/`, so this note follows that location and descriptive filename convention.

This research initially investigated inferring victory when only one eligible campaign seat remains. The user subsequently excluded all victory handling from [SOL-28](https://linear.app/1solon/issue/SOL-28). The victory findings below are retained as research, not implementation requirements. “Public” here means information available to game players under the game's visibility rules; the manual does not specify publication to Shadow Cloud viewers.

## Verified Rules

### Victory Conditions

| Topic | Manual evidence | What it establishes |
| --- | --- | --- |
| Normal victory threshold | §5.15, [p. 350](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=350): “a Victory Score higher than 50” and “the difference with your closest opponent is at least 25 points.” | Both conditions apply: score **strictly greater than 50**, with a lead **greater than or equal to 25**. A score of exactly 50 is insufficient. |
| Score ingredients | §5.15, p. 350: “a mix of the percentage of Planetary Populace and the percentage of the Planetary land Hexes you control.” | Population share and land control both contribute. Territory percentage alone is not the stated Victory Score. The passage does not give the weighting or rounding formula. |
| Multiplayer's normal route | §5.15.1, p. 350: “A game started with multiple Humans has the same victory condition as a single player game.” | Normal score victory also applies in multiplayer. |
| Additional PBEM route | §5.15.1, p. 350: “in a ‘PBEM’ game eliminating all other Human opponents is also considered a victory.” | Eliminating all other human opponents is an alternative victory route; this statement does not require eliminating AI opponents or meeting the score threshold. The subsection is titled “PBEM / Hotseat,” but this sentence explicitly says PBEM. |
| Shared victory | §5.6.14.2, [pp. 239–240](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=239): deals and pacts are possible with “another Major Regime”; military pact Level 3 is “the Victory pact,” making it “possible to attain a Joint Victory and win the game as Allies.” | Joint victory is expressly supported. Friendship (Level 2) and Non-Aggression (Level 1) are separate pact levels; neither is described here as granting joint victory. An informal alliance or an Allies relation label alone is not evidence of a Victory pact. |

### Human, AI, Major And Minor Are Different Distinctions

- **Major regimes are human-playable, not necessarily human-controlled.** §5.6.1.1, [p. 208](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=208): “the Regimes that can be played by humans.” §5.6.2, p. 210: “Your Regime is always a Major Regime.” AI-controlled majors are explicit in §3.1.3.3, [p. 30](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=30): “competing AI controlled Major Regimes.” Counting majors therefore does not count human opponents.
- **Minor regimes are AI-controlled.** §5.6.1.2, [p. 209](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=209): “They are always under AI control.” The same page separately describes Non-aligned Forces and Rebel Regimes, so the complete regime population is broader than campaign seats.
- **An AI major can be a prospective Victory-pact partner.** The Republican culture description in §5.4.1.3, [p. 192](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=192), says: “The Realpolitikers and Corporatists are the only AI Factions that are willing to go as far as to sign a Victory pact with you.” This supports treating joint victory as more than a human-seat grouping. It does not specify the full winner calculation.

### Elimination, Disappearance And Resignation

The victory rule uses “eliminating” without supplying an operational definition in §5.15.1. No explicit general elimination predicate was located in the manual: it does not establish here that loss of a capital, last City, last Zone, last Hex, or last Unit is necessary and sufficient. None should be presented as a verified elimination rule from this source.

Two relevant, explicit rules are narrower:

- **In-game resignation becomes defeat after a turn.** §5.15.2, [p. 351](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=351): call the Secretary to resign; “it takes one turn for your resignation to be turned into a defeat,” and “after resigning you'll always have to press the End Turn button.” This establishes a timing distinction between the action and defeat. It does not establish what happens to the regime's remaining territory or whether every defeat is the elimination used by §5.15.1.
- **A minor can disappear by joining another regime.** §5.6.14.1, [p. 237](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=237): “Joining your Regime means the Minor Regime will completely disappear of its own accord”; “All their Units will switch to friendly Militia Units.” Disappearance is therefore not, by itself, proof of military destruction.

**Public visibility of elimination remains unanswered.** No universal elimination announcement, recipient list, or visibility-independent defeated-regime list was located. The manual's recon rules explicitly limit knowledge of other regimes (see below); a hidden or absent regime in a player's view is not sufficient evidence of elimination.

### Territory Denominator And Visibility

**The stated territory denominator is planetary land Hexes.** §5.15, [p. 350](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=350), says “percentage of the Planetary land Hexes you control.” Read literally, this is the regime's controlled land Hexes divided by all planetary land Hexes, rather than all map Hexes including water, only discovered Hexes, only occupied territory, or only the land held by human opponents. This is a textual interpretation of the named denominator, not a validated save-field formula. Treatment of unusual terrain, off-map cells, unclaimed land and diplomatic dependencies still needs implementation evidence.

**Populace is not merely a count of cities or population alone.** §5.1.9.36, [p. 145](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=145): “Is the sum of your Population and Workers in a certain Zone.” The victory passage names *Planetary Populace* but does not enumerate every inclusion or special case in its planetary total.

| Information | Verified availability | Boundary / unanswered detail |
| --- | --- | --- |
| Victory progress | §5.15, p. 350: “Check the Victory Report in the Reports Tab for a breakdown how far away you are from victory.” | A player-facing report exists. This does not establish its exact columns, whether all rivals' exact scores are shown under complete FOW, or that the same information is available to every player. |
| Regime borders under Partial FOW | §3.1.3.2, [p. 30](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=30): real-time information includes “the borders of all Regimes”; “comparative statistics will be available.” | Strong evidence for broad border visibility with this setting. It does not establish a universally public exact territory-percentage field. |
| Comparative statistics | §3.6.2.2, [p. 49](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=49): other Major Regimes “will only be visible” in “Partial” FOW or “when you have either won or lost the game.” | Comparative statistics are not universally visible during ordinary complete-FOW play. This passage does not enumerate exact territory/victory metrics and should not be used to invent the Victory Report's visibility rules. |
| Knowledge of other regimes and their territory | §5.14.2.1, [pp. 347–348](https://www.matrixgames.com/amazon/PDF/SE/Shadow_Empire_manual_EBOOK.pdf#page=347): “The more Recon Points, the more you know”; at Level 1, “You know the Regime exists”; at Level 10, “You know the boundaries of the Zones the Regime controls.” | Knowledge is viewer-dependent. Zone boundaries are not evidence that exact global territory shares or elimination events are public at all recon levels. |
| Additional statistics after defeat | §5.15.2, p. 351: in single-player FOW, after resignation “more statistics will be visible to you.” | Post-defeat visibility is distinct from information available to active opponents. |

## Implications For The One-Eligible-Seat Rule

These are deductions and interview boundaries, not a selected Shadow Cloud policy:

1. **AI opponents remaining does not invalidate the manual's additional PBEM victory route.** Its predicate concerns elimination of all other *human opponents*, not elimination of every regime. This is a better fit for the user's intention than a rule requiring only one regime on the planet. [§5.15.1, p. 350]
2. **One eligible campaign seat is not that predicate by definition.** A seat may be open, have its occupant replaced, or become ineligible for a Cloud action without its associated regime being defeated. The glossary distinguishes those objects; the manual's victory condition refers to in-game opponents. The inference needs a defined relationship between seat eligibility, regime association and actual in-game elimination. [CONTEXT.md; §5.15.1, p. 350]
3. **“Only one human remains” needs history and game-mode context.** The section discusses a game started with multiple humans and provides the extra route explicitly for PBEM. A single-player game starting with one human is not thereby immediately won. A reduction in human-controller count due to takeover or conversion to AI is not demonstrated by this source to equal elimination. [§5.15.1, p. 350]
4. **A single-winner seat event does not capture all documented victories.** Normal score victory can occur without eliminating all other human opponents, and a Victory pact allows joint victory. How campaign seats should represent those outcomes is an interview decision. The manual does not provide a full alliance scoring/propagation algorithm. [§5.15, p. 350; §5.6.14.2, p. 240]
5. **Save availability does not establish public visibility.** Exact global state recovered from a save could exceed a player's allowed knowledge. The manual explicitly conditions borders/comparative statistics on FOW or end-game state, while leaving exact Victory Report and elimination visibility unresolved. [pp. 30, 49, 348, 350–351]
6. **Existing save-inspection eligibility is not victory eligibility.** [`docs/save-format.md`](save-format.md), “Format Evidence,” documents a password-reset reader that excludes AI and requires a nonempty in-game password; its source-derived regime IDs are valid only for those bytes. Those are repository implementation facts about reset targeting, not manual rules for survival, victory, or persistent regime association.

## Questions Identified During Research

These were research questions, not an outstanding design questionnaire. SOL-28 records the agreed behavior: victory is out of scope, player elimination is treated as public information per the user's clarification, AI visibility is separately gated, and territorial milestones use all planetary land Hexes subject to verified public visibility. Save-field semantics still require validation.

- Does “eligible seat” mean an associated, non-eliminated human-controlled regime, or can campaign resignation, vacancy, removal, or some other Cloud action end eligibility? If the latter, the proposed rule is a campaign outcome policy beyond the verified PBEM predicate.
- Must a campaign have started with multiple human opponents, and be PBEM, before this inference applies? What should happen when a human regime becomes AI-controlled without defeat?
- What authoritative save evidence identifies elimination or completed in-game resignation, and on which turn does it take effect? Does defeat leave a surviving AI regime? These require game-version-specific save/engine evidence; the manual does not resolve them.
- Should normal score victories and Victory-pact joint victories also produce campaign events? How are AI partners, human partners and multiple linked pacts represented? The manual verifies the feature, not its complete calculation.
- Which recipients may see an elimination, exact territory percentage or victory statistic? Is the intended event derived from universally visible information, each seat's available knowledge, an end-game disclosure, or a separately agreed campaign policy?
- For exact territory/score calculations: what are the land-Hex classifier, population inclusions, ownership rules, pact contributions, score weights, rounding, closest-opponent selection and evaluation timing? Verify these against the applicable game build before claiming exact save-derived parity.

## Research Limits

The official PDF was downloaded to `/tmp/opencode/shadow-empire-manual.pdf` and extracted with `pdftotext -layout`. Searches covered victory, elimination, defeat, resignation, loss/conquest, regime types, alliances/pacts, territory, statistics and recon; relevant sections were read in context. Absence findings mean no explicit answer was located in this manual, not proof that the game has no such rule. No save was inspected, no engine behavior was tested, and no later patch rules were verified for this note.

## SOL-28 Implementation Evidence Gate

Repository inspection on 2026-09-10 found no validated multi-save corpus establishing the additional save semantics required by SOL-28. The existing [save-format evidence](save-format.md) covers password-reset targeting in one observed save; automated save fixtures are synthetic and are not playable game saves. A stored save artifact alone cannot establish identity stability or before/after elimination behavior. No stored campaign save or credential is included in this document or the associated draft PR.

The following requirements remain blocked, rather than implemented with guessed predicates:

| Required evidence | What must be established |
| --- | --- |
| Persistent regime identity | The same regime can be identified across consecutive turns and save corrections, independently of archive bytes, display names, and upload authorship. |
| Elimination | A controlled before/after example distinguishes actual elimination from missing data, peaceful absorption, resignation timing, or a change to AI control. |
| Territorial control | Save fields identify owned land Hexes and the complete planetary land denominator, with game-report cross-checks. |
| Public visibility | Game settings and player-visible reports establish when exact territory shares and AI elimination information are available to all participants. |

To resume, obtain an authorized, disposable campaign save corpus with the game version, relevant fog-of-war settings, expected in-game outcomes, and consecutive saves covering these transitions. Supply any archive access material through the existing secret configuration, not issue descriptions, commits, or test fixtures. Keep original private saves out of version control; derive safe regression fixtures only after validating their semantics against the game.

This gate is required by SOL-28's save-reader testing decisions: synthetic fixtures alone cannot establish actual game-format semantics. No claims, event generation, elimination controls, or turn-eligibility changes have been implemented by this research-only change. The canonical feature specification remains in Linear.
