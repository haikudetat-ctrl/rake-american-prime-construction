"use client";

import { useRef, useState } from "react";
import { AddressField } from "@/app/_components/address-field";
import { ContactFields, FieldError, IntakeWizard } from "@/app/_components/intake-wizard";
import { useIntakeSubmit } from "@/app/_components/use-intake-submit";
import { shrinkPhoto } from "@/lib/images/shrink";
import type { IntakeFailure } from "@/lib/intake/messages";
import { CONTACT_CONSENT, MAX_PHOTOS, NEED_LABEL, NEEDS, PHOTO_TYPES, type Need } from "@/lib/leads/schema";
import s from "@/app/_components/intake.module.css";

const MAX_UPLOAD_BYTES = 3_500_000;

async function shrinkPhotos(form: FormData): Promise<string | null> {
  const photos = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
  if (photos.length > MAX_PHOTOS) return `Choose up to ${MAX_PHOTOS} photos. Go back to project details to change your selection.`;
  if (photos.some(photo => !PHOTO_TYPES[photo.type])) return "Choose JPG, PNG, WebP, or HEIC photos. Go back to project details to change your selection.";
  form.delete("photos");
  const shrunk = await Promise.all(photos.map((photo, index) => shrinkPhoto(photo, `roof-${index + 1}.jpg`)));
  let total = 0;
  for (const photo of shrunk) {
    total += photo.size;
    if (total > MAX_UPLOAD_BYTES) return "Those photos are too large to send. Go back and try fewer, or send them by text after.";
    form.append("photos", photo);
  }
  return null;
}

export function LeadForm({ action, formToken, defaultNeed }: {
  action: (form: FormData) => Promise<IntakeFailure | undefined>;
  formToken: string;
  defaultNeed?: Need;
}) {
  const { pending, failure, problem, bad, onSubmit } = useIntakeSubmit(action, shrinkPhotos);
  const [photos, setPhotos] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  return <IntakeWizard kind="roofing" formToken={formToken} pending={pending} failure={failure} problem={problem} onSubmit={onSubmit}
    project={<>
      <fieldset className={s.choiceGroup}><legend>What can we help with?</legend>
        <div className={s.choices}>{NEEDS.map(need=><label key={need} className={s.choice}>
          <input type="radio" name="need" value={need} defaultChecked={defaultNeed === need} required />
          <span className={s.choiceBody}>{need === "other" ? "Something else / not sure" : NEED_LABEL[need]}</span>
        </label>)}</div><FieldError name="need" />
      </fieldset>
      <div><AddressField label="Property address" formToken={formToken} bad={bad} /><FieldError name="address" /><FieldError name="town" /><FieldError name="zip" /></div>
      <details className={s.details}><summary>Add notes or photos <span className={s.optional}>Optional</span></summary>
        <div className={s.fields}>
          <label className={s.field}><span>Anything you&apos;ve noticed?</span><textarea name="notes" rows={3} maxLength={2000} className="input" placeholder="A leak, missing shingles, the age of your roof, or a good time to reach you…" /><FieldError name="notes" /></label>
          <div className={s.photos}><label htmlFor="roof-photos" className={s.field}>Add up to {MAX_PHOTOS} photos</label><p className={s.hint}>Only if you already have them. No need to get on the roof.</p>
            <input ref={fileRef} id="roof-photos" name="photos" type="file" accept={Object.keys(PHOTO_TYPES).join(",")} multiple aria-describedby="roof-photo-help" onChange={event=>{
              const files = Array.from(event.target.files ?? []);
              setPhotos(files.map(file=>file.name));
              event.target.setCustomValidity(files.length > MAX_PHOTOS ? `Choose no more than ${MAX_PHOTOS} photos.` : files.some(file=>!PHOTO_TYPES[file.type]) ? "Choose JPG, PNG, WebP, or HEIC photos." : "");
            }} />
            <FieldError name="photos" /><p id="roof-photo-help" className={s.hint}>JPG, PNG, WebP, or HEIC. Large photos are resized before sending.</p>
            {photos.length > 0 && <><ul className={s.photoList}>{photos.map((name,index)=><li key={`${name}-${index}`}>{name}</li>)}</ul><button type="button" className={s.clearPhotos} onClick={()=>{if(fileRef.current) { fileRef.current.value=""; fileRef.current.setCustomValidity(""); }setPhotos([]);}}>Remove photos</button></>}
            {photos.length > MAX_PHOTOS && <p role="alert" className={s.error}>Choose no more than {MAX_PHOTOS} photos. Remove these and select fewer.</p>}
          </div>
        </div>
      </details>
    </>}
    contact={<>
      <ContactFields />
      <label className={s.consent}><input type="checkbox" name="consent" /><span><strong>Text updates <span className={s.optional}>Optional</span></strong><br />{CONTACT_CONSENT}</span></label>
    </>} />;
}
