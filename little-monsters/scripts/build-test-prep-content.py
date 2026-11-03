"""Build the original, versioned starter curriculum; no official questions are copied.
CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Original test-prep lessons and variant bank.
2 | maintainer@emeraldcoastsystemsgroup.com | Each lesson takes its poster, teacher, length and transcript from the filmed lesson's manifest.
"""
import json, random
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
lessons, questions = [], []
filmed = json.loads((ROOT/'tools/prep-media/manifest.json').read_text())['lessons']

def lesson(key, title, domain, learn, example, shortcut, caution, mistake):
    sections = {'SAT': 'math' if domain == 'math' else 'rw', 'ACT': {'math':'math','english':'english','reading':'reading','science':'science'}[domain]}
    if domain == 'science': sections.pop('SAT')
    frames = [
        {'title':'Learn the idea', 'text':learn}, {'title':'Work an example', 'text':example},
        {'title':'A faster route', 'text':shortcut}, {'title':'Know the limit', 'text':caution},
        {'title':'Remember next time', 'text':mistake},
    ]
    lessons.append(dict(id=key,title=title,domain=domain,sections=sections,learn=learn,example=example,
                        shortcut=shortcut,caution=caution,mistake=mistake,frames=frames,
                        video=f'/api/education/prep-media/{key}.mp4',captions=f'/api/education/prep-media/{key}.vtt',
                        poster=f'/api/education/prep-media/{key}.jpg',teacher=filmed[key]['teacher'],
                        seconds=filmed[key]['seconds'],transcript=filmed[key]['transcript']))

lesson('linear','Solve for what is asked','math','Keep equations balanced. Identify whether the question asks for x or an expression in x.',
       'If 3x + 7 = 22, subtract 7 to get 3x = 15. If the question asks for 3x, the answer is already 15.',
       'Stop as soon as you have the requested expression. For multiple choice, substituting options into the original equation can also be quick.',
       'Substitution must satisfy the original equation. Do not stop at x if the question asks for 3x.',
       'Underline the requested quantity before calculating.')
lesson('systems','Eliminate a variable','math','Adding or subtracting equations can cancel a variable and preserve the solution.',
       'x + y = 12 and x - y = 4. Add the equations: 2x = 16, so x = 8 and y = 4.',
       'Look for matching or opposite coefficients before substituting. On SAT, graphing both equations can reveal their intersection.',
       'A graph window can hide intersections. Check the proposed point in both original equations.',
       'Use both equations; a point on only one line is not necessarily a solution.')
lesson('percent','Use percent multipliers','math','A percent change multiplies the starting value by 1 plus or minus the rate.',
       'A $50 item with a 20 percent discount costs 50 × 0.8 = $40.',
       'Combine successive changes by multiplying their factors. A 20 percent rise then a 20 percent fall gives 1.2 × 0.8 = 0.96.',
       'Equal percentage increases and decreases do not cancel because their bases differ.',
       'Name the base. A change from 40 to 50 is 25 percent, not 20 percent.')
lesson('quadratic','Read factored quadratics','math','A product is zero when at least one of its factors is zero.',
       '(x - 3)(x + 5) = 0 has solutions 3 and -5. Their sum is -2.',
       'For x² + bx + c = 0, the roots sum to -b. For ax² + bx + c, the sum is -b/a.',
       'This shortcut gives a sum, not individual roots; keep the leading coefficient and signs.',
       'Check whether the question asks for one root, both roots, their sum or their product.')
lesson('geometry','Scale areas carefully','math','Similar figures have proportional lengths. Areas scale by the square of the length factor.',
       'Doubling each side of a square multiplies its area by four: 3² = 9, while 6² = 36.',
       'Use a scale factor instead of recalculating every dimension. Volumes scale by the cube of the length factor.',
       'Use this only for similar shapes with all corresponding lengths scaled equally.',
       'Label units: length, square units for area, cubic units for volume.')
lesson('data','Turn means into totals','math','The mean equals the total divided by the number of observations.',
       'Four scores average 12, so their total is 48. Add a score of 17: the new mean is 65/5 = 13.',
       'Recover the old total first; you do not need to know each original observation.',
       'Do not average two averages unless their group sizes are equal; use weighted totals.',
       'Update both the total and the count when adding a value.')
lesson('probability','Count the right sample space','math','For equally likely outcomes, probability is favorable outcomes divided by all eligible outcomes.',
       'A bag holds 3 red and 7 blue tiles. The chance of drawing red is 3/10.',
       'For at least one success, sometimes compute 1 minus the probability of no successes.',
       'Without replacement, the counts change after a draw. Independence is not automatic.',
       'Read restrictions such as given that, without replacement, and at least.')
lesson('trig','Use right-triangle ratios','math','Sine is opposite/hypotenuse, cosine is adjacent/hypotenuse, and tangent is opposite/adjacent.',
       'A right triangle has legs 3 and 4 and hypotenuse 5. For the angle opposite 3, sine is 3/5.',
       'Label the opposite side relative to the named angle before using SOH-CAH-TOA.',
       'These side ratios apply directly to right triangles. The opposite side changes when the named angle changes.',
       'The hypotenuse faces the right angle and is the longest side.')
lesson('boundaries','Join complete sentences','english','Two independent clauses need a period, a semicolon, or a comma with a coordinating conjunction.',
       'The lab closed; the students went home. Both sides can stand alone, so a semicolon works.',
       'Find the subject and verb on each side before inspecting punctuation choices.',
       'A comma alone cannot join two independent clauses. A semicolon cannot join an independent clause to a fragment.',
       'Read the whole sentence, not just the underlined words.')
lesson('agreement','Find the real subject','english','A verb agrees in number with its subject, not with a nearby noun in a modifying phrase.',
       'The box of pencils is on the desk. The subject is box, not pencils.',
       'Temporarily cross out a phrase such as of pencils, then match the subject and verb.',
       'Do not cross out essential parts of compound subjects; the box and the bag are two subjects.',
       'Nearby plural nouns can distract you from a singular subject.')
lesson('concision','Remove true redundancy','english','Clear writing removes repeated meaning while keeping all necessary details and grammatical structure.',
       'The final outcome was clear repeats finality. The outcome was clear preserves the meaning.',
       'Compare the meaning of each word. Remove only words that add nothing.',
       'The shortest choice is not automatically correct. It must preserve meaning, grammar and the requested emphasis.',
       'Check the complete revised sentence after selecting a concise answer.')
lesson('transitions','Name the logical relationship','english','Transitions signal contrast, continuation, example or cause and effect.',
       'The team practiced daily. Nevertheless, it lost the match. The second sentence contrasts with the expectation.',
       'Predict the relationship in your own words before looking at the options.',
       'Two facts appearing together do not prove cause and effect; do not insert therefore without support.',
       'Read the sentence before and after the blank.')
lesson('possessives','Separate plurals from ownership','english','Apostrophes mark possession or contractions, not ordinary plurals.',
       'One teacher owns a desk: the teacher’s desk. Several teachers share a lounge: the teachers’ lounge.',
       'First decide how many owners there are, then form the possessive.',
       'Irregular plurals such as children use children’s. Its is possessive; it’s means it is or it has.',
       'Replace it’s with it is to test a contraction.')
lesson('purpose','Match the writing goal','english','A sentence must serve the writer’s specific requested purpose, using relevant supported facts.',
       'To emphasize a library’s accessibility, mention its evening hours and step-free entrance, not its brick color.',
       'Read the writing goal first. Eliminate accurate details that do not accomplish that goal.',
       'A relevant choice must still be supported; do not add claims such as everyone can attend without evidence.',
       'True is necessary, but the answer must also do the requested job.')
lesson('mainidea','Keep the right scope','reading','A main idea covers the central point of the passage without adding unsupported generalizations.',
       'A passage says a neighborhood garden increased local pollinator visits. Its point concerns that garden, not every garden worldwide.',
       'Write a short headline for the passage before comparing options.',
       'An interesting detail may be true but too narrow. Words such as always and all need strong support.',
       'Match the author’s scope and degree of certainty.')
lesson('evidence','Choose what the text supports','reading','An inference must follow from the evidence, not just sound plausible.',
       'A museum extended Saturday hours after visitors requested evening access. The requests influenced the schedule; the text does not prove attendance doubled.',
       'For each choice, point to a specific fact that supports it. Eliminate choices requiring a new assumption.',
       'Outside knowledge cannot replace evidence from the passage.',
       'Separate what is stated, what follows, and what is merely possible.')
lesson('vocabulary','Predict meaning in context','reading','A word’s meaning depends on how the author uses it in the sentence.',
       'In the researcher advanced a hypothesis, advanced means proposed, not moved forward physically.',
       'Cover the choices and insert a simple word of your own, then compare meanings.',
       'A familiar dictionary meaning can be wrong in this context. Check tone and grammar too.',
       'Reread the sentence with your selected meaning.')
lesson('structure','Find each sentence’s job','reading','An author may introduce a claim, supply evidence, acknowledge a limitation or contrast ideas.',
       'A report first describes a promising result, then notes that only six plants were tested. The final sentence limits the strength of the conclusion.',
       'Label the relationship between sentences: claim → evidence → limitation.',
       'A limitation does not necessarily overturn a result; avoid answers that exaggerate disagreement.',
       'Explain why the sentence is there, not just what topic it mentions.')
lesson('science-data','Read axes and units first','science','A table or graph encodes measurements. Identify variables and units before comparing values.',
       'A table lists 10, 20 and 30 minutes with temperatures 18, 22 and 26 degrees. At 20 minutes the value is 22 degrees.',
       'Use the question to locate the relevant row, column or curve before reading unrelated details.',
       'Check legends and axis scales. A broken or logarithmic scale changes how distances represent values.',
       'Distinguish interpolation within the data from uncertain extrapolation beyond it.')
lesson('science-design','Change one variable','science','A controlled experiment varies an independent variable and measures an outcome while holding other conditions constant.',
       'To test light’s effect on growth, vary light duration while keeping plant species, water and soil the same.',
       'Ask what changed deliberately and what was measured. Those identify the independent and dependent variables.',
       'Correlation in an observational study is not by itself proof of causation.',
       'A fair comparison controls plausible alternative explanations.')
lesson('science-claims','Compare predictions','science','Competing explanations can be tested by finding an observation on which their predictions differ.',
       'One model predicts that salt speeds melting; another predicts no change. Compare equal ice samples with and without salt under matched conditions.',
       'Make a small table: each model’s claim, its predicted result, and the observed evidence.',
       'Agreement with one observation supports a model but does not prove it universally true.',
       'Answer according to the stated model, even if another claim seems more familiar.')

lookup = {l['id']:l for l in lessons}
def add(key, n, stem, correct, wrong, explanation):
    options = [str(correct)] + [str(x) for x in wrong]
    assert len(set(options)) == 4, (key,n,options)
    rng = random.Random(f'{key}:{n}'); rng.shuffle(options)
    l = lookup[key]
    questions.append(dict(id=f'{key}-{n:02}',family=key,skill=key,sections=l['sections'],difficulty='foundation',
                          prompt=stem,options=options,answer=options.index(str(correct)),explanation=explanation,
                          targetSeconds={'math':80,'english':40,'reading':65,'science':55}[l['domain']]))

names=['Maya','Leo','Ari','Nia','Sam','Noor','Eli','Zoe','Iris','Omar']
places=['garden','museum','library','workshop','observatory','theater','archive','studio','aquarium','gallery']
for n in range(10):
    a=n+2; x=n+4; b=n+3; total=a*x+b
    add('linear',n,f'If {a}x + {b} = {total}, what is the value of {a}x?',a*x,[x,total,a*x-b],f'Subtract {b} from both sides: {a}x = {a*x}. The question asks for {a}x, so stop there.')
    y=n+1
    add('systems',n,f'If x + y = {x+y} and x - y = {x-y}, what is x?',x,[y,2*x,x+y],f'Add the equations to cancel y: 2x = {2*x}. Divide by 2 to get x = {x}.')
    price=50+10*n
    add('percent',n,f'A jacket costs ${price}. It is discounted by 20%. What is the sale price?',price*8//10,[price//5,price*12//10,price-7],f'The buyer pays 80%: {price} × 0.8 = {price*8//10}. The discount amount alone is not the sale price.')
    r=n+2; s=n+5
    add('quadratic',n,f'What is the sum of the solutions to (x - {r})(x + {s}) = 0?',r-s,[r+s,s-r,-r*s],f'The roots are {r} and {-s}; their sum is {r-s}. Notice the sign of the second root.')
    scale=n+2
    add('geometry',n,f'A square has area 9 square units. A similar square has side lengths {scale} times as long. What is its area?',9*scale*scale,[9*scale,3*scale,9+scale],f'Area scales by the square of the length factor: 9 × {scale}² = {9*scale*scale}.')
    mean=10+n
    add('data',n,f'Four values have a mean of {mean}. A fifth value, {mean+5}, is added. What is the new mean?',mean+1,[mean,mean+5,mean+2],f'The old total is {4*mean}. Add {mean+5} and divide by 5: {5*mean+5}/5 = {mean+1}.')
    red=n+2; blue=n+7
    add('probability',n,f'A bag contains {red} red tiles and {blue} blue tiles. One tile is drawn at random. What is the probability it is red?',f'{red}/{red+blue}',[f'{blue}/{red+blue}',f'{red}/{blue}',f'1/{red+blue}'],f'There are {red} favorable tiles among {red+blue} equally likely tiles, so the probability is {red}/{red+blue}.')
    k=n+1
    add('trig',n,f'A right triangle has legs {3*k} and {4*k}, and hypotenuse {5*k}. For the angle opposite the side of length {3*k}, what is its sine?','3/5',['4/5','3/4','5/3'],f'Sine is opposite divided by hypotenuse: {3*k}/{5*k} = 3/5.')
    name=names[n]; place=places[n]
    add('boundaries',n,f'Which sentence uses punctuation correctly?',f'The {place} closed; {name} went home.',[f'The {place} closed, {name} went home.',f'The {place} closed {name} went home.',f'The {place} closed; and {name} went home.'],f'“The {place} closed” and “{name} went home” are independent clauses. A semicolon joins them without a conjunction.')
    subjects=['box','bundle','collection','stack','packet','set','group','row','pair','pile']
    add('agreement',n,f'Choose the verb that completes this sentence in standard English: The {subjects[n]} of postcards ___ on the desk.','is',['are','were','have been'],f'The singular subject is {subjects[n]}. The phrase “of postcards” does not change its number, so use “is.”')
    add('concision',n,f'Which revision is clearest and avoids redundancy? “{name} returned back to the {place} again for a second time.”',f'{name} returned to the {place} for a second time.',[f'{name} returned back again to the {place} for a second time.',f'{name} returned back to the {place} again for a second time.',f'{name} to the {place} for a second time.'],'“Returned” already conveys going back. Keep “for a second time” to preserve the specific visit count; the shortest fragment is not a sentence.')
    add('transitions',n,f'Choose the best transition: “The {place} advertised widely. ___, fewer people visited than expected.”','Nevertheless',['Therefore','For example','Similarly'],'The low attendance contrasts with the expectation created by advertising. “Nevertheless” marks that contrast.')
    add('possessives',n,f'Three teachers share one lounge at the {place}. Which phrase correctly describes it?',"the teachers’ lounge",["the teacher’s lounge","the teachers lounge","the teachers’s lounge"],'There are multiple owners. The regular plural “teachers” takes an apostrophe after s: teachers’ lounge.')
    add('purpose',n,f'The {place} opens until 9 p.m., has a step-free entrance, and was built in 1980. Which sentence best emphasizes access for visitors?',f'The {place} offers evening hours and a step-free entrance.',[f'The {place} was built in 1980.',f'Every visitor can always reach the {place} without difficulty.',f'The {place} is the oldest building in town.'],'Evening hours and a step-free entrance both support access. The other choices are irrelevant or add unsupported claims.')
    add('mainidea',n,f'Volunteers at a neighborhood {place} added native flowers. Over the next month, observers recorded more pollinator visits there. The volunteers plan to continue counting visits. Which is the best main idea?',f'A local planting project was followed by more recorded pollinator visits.', ['All native flowers always attract more pollinators than other plants.','Volunteers proved that every pollinator population is increasing.','Counting visits is unnecessary once flowers are planted.'],'The answer describes this local observation without turning it into a universal claim or claiming proof of cause.')
    add('evidence',n,f'The {place} moved its Saturday closing time from 5 p.m. to 8 p.m. after visitors requested evening access. Which inference is best supported?', 'Visitor requests influenced the schedule.', ['Attendance doubled immediately.','The building is now open all night.','Most visitors dislike afternoon visits.'],'The passage links the change to the requests. It gives no attendance counts or evidence about most visitors’ preferences.')
    verbs=[('advanced','proposed','The researcher advanced a new explanation.'),('qualified','limited','The researcher qualified the conclusion by noting the small sample.'),('marked','noticeable','The experiment produced a marked change in temperature.'),('novel','new','The team proposed a novel solution to the problem.'),('sustained','maintained','The gardener sustained a steady watering schedule.'),('yielded','produced','The study yielded unexpected results.'),('addressed','considered','The report addressed the problem of missing data.'),('challenged','questioned','The new evidence challenged the earlier conclusion.'),('modest','small','The project led to a modest increase in attendance.'),('critical','essential','Accurate measurement is critical to this experiment.')]
    word,meaning,sentence=verbs[n]
    add('vocabulary',n,f'In “{sentence}” what does “{word}” most nearly mean?',meaning,['decorated','forgotten','celebrated'],f'In this sentence “{word}” means “{meaning}.” Substitute that meaning and check the sense of the whole sentence.')
    add('structure',n,f'A report describes increased visits to a {place} after a new program began. It concludes, “Only one month of data is available, so longer observation is needed.” What is the function of that final sentence?', 'To acknowledge a limit on the evidence.', ['To prove the program failed.','To introduce a different program.','To show the observations were invented.'],'The sentence limits how strongly the result can be interpreted. It does not say the result is false.')
for n in range(14):
    base=10+n; step=2+n
    add('science-data',n,f'A table pairs time (minutes) and temperature (°C): 5 → {base}, 10 → {base+step}, 15 → {base+2*step}. What temperature was measured at 10 minutes?',base+step,[base,base+2*step,base+3*step],f'Find the time value 10 minutes, then read its paired temperature: {base+step} °C. Do not confuse time with temperature.')
    variables=[('light duration','plant height','plant species and water amount'),('water amount','plant height','plant species and light duration'),('water temperature','time to dissolve sugar','sugar mass and water volume'),('salt concentration','ice melting time','ice mass and room temperature'),('ramp angle','cart travel time','cart mass and ramp length'),('fertilizer amount','plant mass','plant species and water amount'),('pendulum length','swing period','bob mass and release angle')]
    independent,dependent,controlled=variables[n%7]
    add('science-design',n,f'Trial {n+1} tests how {independent} affects {dependent}, keeping {controlled} constant. What is the independent variable?',independent,[dependent,controlled,'the trial number'],'The independent variable is the condition deliberately changed: '+independent+'. The measured outcome is '+dependent+'.')
    add('science-claims',n,f'Model A predicts sample {n+1} dissolves faster in warm water than cold water. Model B predicts the same dissolving time at both temperatures. Which result supports A over B?', 'The matched warm-water sample dissolves in less time.', ['Both samples dissolve in the same time.','Only the cold-water sample is observed.','The samples have different masses and temperatures.'],'A predicts a shorter time in warm water. Matched sample conditions make the comparison informative; changing mass adds a confounding variable.')

out=ROOT/'data/test-prep';out.mkdir(parents=True,exist_ok=True)
(out/'catalog.json').write_text(json.dumps(dict(version='2026.10.28.1',lessons=lessons,questions=questions),ensure_ascii=False,indent=2)+'\n')
print(f'{len(lessons)} lessons, {len(questions)} original practice variants')
