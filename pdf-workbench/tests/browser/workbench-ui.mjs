/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | PDF Workbench 0.3.0 (the oshal design standard): the browser proofs reach the controls the way a person now does. Originals, page tools, form fields and saved history live in opaque sheets the document menu and the modes open (docs/ux/design-standard.md §4.4), so each helper opens the sheet, does the step through the real controls and closes it with Done.
 */

/** @description Close every open menu or sheet with its Done, as a person does. @param {import('playwright').Page} page @returns {Promise<void>} */
export async function closeLayers(page){for(let n=0;n<4&&await page.locator('dialog.ds-layer[open]').count();n+=1)await page.locator('dialog.ds-layer[open] .ds-layer-done').last().click();}

/** @description Open a document-menu item. @param {import('playwright').Page} page @param {string} item the menu item's name @returns {Promise<void>} */
export async function documentMenu(page,item){await closeLayers(page);await page.locator('#doc-menu').click();await page.getByRole('menuitem',{name:item}).click();}

/**
 * @description Preserve an original PDF and create a document from it through the Originals sheet, then close the sheet.
 * @param {import('playwright').Page} page @param {string} file the PDF's path @param {string} sourceTitle the original's title @param {string} title the new document's title
 * @returns {Promise<void>}
 */
export async function uploadAndCreate(page,file,sourceTitle,title){
 await documentMenu(page,'Originals and images…');await page.locator('dialog.ds-layer[open] #source-title').waitFor();
 await page.locator('#file').setInputFiles(file);await page.locator('#source-title').fill(sourceTitle);await page.locator('#upload button').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Original PDF preserved'));
 if(title)await page.locator('#title').fill(title);await page.locator('#create').click();
 await page.locator('[data-pdf-view="document"]').waitFor({timeout:60000});await closeLayers(page);
}

/** @description Leave the open mode with Done, so the mode bar shows again. @param {import('playwright').Page} page @returns {Promise<void>} */
export async function leaveMode(page){if(await page.locator('.pdf-done').isVisible())await page.locator('.pdf-done').click();}

/** @description Enter the Edit mode, whose strip holds Text, Image, Rectangle, Ellipse, Format and Delete. @param {import('playwright').Page} page @returns {Promise<void>} */
export async function editMode(page){await closeLayers(page);if(await page.locator('.pdf-chrome').getAttribute('data-pdf-mode')==='edit')return;await leaveMode(page);await page.locator('.pdf-mode[data-mode="edit"]').click();await page.locator('.pdf-strip').waitFor();}

/** @description Open the Pages sheet from the Pages mode. @param {import('playwright').Page} page @returns {Promise<import('playwright').Locator>} the sheet */
export async function openPages(page){await closeLayers(page);await leaveMode(page);await page.locator('.pdf-mode[data-mode="pages"]').click();const sheet=page.locator('dialog.ds-layer[open]');await sheet.locator('#rotate').waitFor();return sheet;}

/** @description Select the first page in the Pages sheet and rotate it, then close the sheet. @param {import('playwright').Page} page @returns {Promise<void>} */
export async function rotateFirstPage(page){const sheet=await openPages(page);await sheet.locator('.pdf-page-tile input[type=checkbox]').first().check();await sheet.locator('#rotate').click();await closeLayers(page);}

/** @description Open the Form fields sheet from the Sign mode. @param {import('playwright').Page} page @returns {Promise<void>} */
export async function openFormFields(page){await closeLayers(page);if(!await page.locator('.pdf-strip').isVisible()||await page.locator('.pdf-chrome').getAttribute('data-pdf-mode')!=='sign'){if(await page.locator('.pdf-done').isVisible())await page.locator('.pdf-done').click();await page.locator('.pdf-mode[data-mode="sign"]').click();}await page.locator('.pdf-strip').getByRole('button',{name:'Fields',exact:true}).click();await page.locator('dialog.ds-layer[open] #fill').waitFor();}

/** @description Open the Saved history sheet from the document menu. @param {import('playwright').Page} page @returns {Promise<void>} */
export async function openHistory(page){await documentMenu(page,'Saved history…');await page.locator('dialog.ds-layer[open] #history').waitFor();}

/** @description On a phone, open the Format sheet from the Edit mode. @param {import('playwright').Page} page @returns {Promise<void>} */
export async function openFormat(page){await editMode(page);await page.locator('.pdf-strip').getByRole('button',{name:'Format',exact:true}).click();await page.locator('dialog.ds-layer[open] .ef-inspector').waitFor();}
