# Turn Timing Policy Editor Simplification Design

## Goal

Reduce the timing-policy editor from three nested bordered surfaces to a clearer two-level hierarchy without changing behavior.

## Visual Structure

Keep the Campaign Details card and the bordered `Turn timing policy` fieldset. Remove the bordered, tinted tile treatment around each timing field and around the Enabled checkbox.

Inside the fieldset:

- Render each duration label directly above its input.
- Retain each input's existing border, focus state, dimensions, and numeric constraints.
- Render the Enabled checkbox as a plain aligned label and control.
- Preserve the four-column desktop grid and responsive wrapping at narrower widths.

The result has one group border and one control border rather than group, tile, and control borders.

## Behavior And Accessibility

Do not change draft state, validation, request payloads, save/cancel behavior, or authorization. Keep the semantic `fieldset` and `legend`, and retain accessible labels for every input and the checkbox.

## Verification

Component tests must verify that:

- The timing-policy group remains exposed through its legend.
- All timing controls retain their accessible labels and values.
- Timing controls no longer use the bordered tile wrapper treatment.
- Existing policy editing and validation tests continue to pass.

Run web typecheck and the complete web test suite.

## Out Of Scope

- Changing the read-only Campaign Details tiles.
- Changing input styling or dimensions.
- Changing timing-policy behavior or API contracts.
- Restyling other campaign metadata fields.
