"use client";

import { AddressField } from "@/app/_components/address-field";
import { ContactFields, FieldError, IntakeWizard, TextField } from "@/app/_components/intake-wizard";
import { useIntakeSubmit } from "@/app/_components/use-intake-submit";
import { DUMPSTER_SIZES } from "@/lib/intake/sizes";
import type { IntakeFailure } from "@/lib/intake/messages";
import s from "@/app/_components/intake.module.css";

export function RequestForm({ action, formToken, today, tomorrow, defaultSize }: {
  action: (form: FormData) => Promise<IntakeFailure | undefined>;
  formToken: string; today: string; tomorrow: string; defaultSize?: number;
}) {
  const { pending, failure, problem, bad, onSubmit } = useIntakeSubmit(action);
  return <IntakeWizard kind="dumpster" formToken={formToken} pending={pending} failure={failure} problem={problem} onSubmit={onSubmit}
    project={<>
      <fieldset className={s.choiceGroup}><legend>How much space do you need?</legend>
        <div className={s.choices}>{DUMPSTER_SIZES.map(size=><label key={size} className={s.choice}><input type="radio" name="sizeYards" value={size} defaultChecked={defaultSize === size} /><span className={s.choiceBody}>{size}-yard dumpster</span></label>)}
          <label className={s.choice}><input type="radio" name="sizeYards" value="" defaultChecked={!defaultSize} /><span className={s.choiceBody}>Not sure — help me choose</span></label>
        </div><p className={s.hint} style={{ marginTop: 10 }}>A starting point. We&apos;ll confirm the right size with you.</p>
      </fieldset>
      <TextField label="Preferred drop-off date" name="requestedDate" type="date" required min={today} defaultValue={tomorrow} hint="Your preferred date, subject to availability. We’ll confirm before scheduling." />
      <div><AddressField label="Delivery address" formToken={formToken} bad={bad} /><FieldError name="address" /><FieldError name="town" /><FieldError name="zip" /></div>
      <details className={s.details}><summary>Add project or placement details <span className={s.optional}>Optional</span></summary><div className={s.fields}>
        <label className={s.field}><span>What are you working on?</span><textarea name="notes" maxLength={1000} rows={3} className="input" placeholder="A garage cleanout, renovation debris, driveway access, or where you’d like it placed…" /><FieldError name="notes" /></label>
      </div></details>
    </>}
    contact={<>
      <ContactFields rental />
      <p className={s.hint}>By sending this you agree we may call or text you about this rental. Message and data rates may apply.</p>
    </>} />;
}
