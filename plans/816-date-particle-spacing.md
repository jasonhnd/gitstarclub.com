# Issue 816: repair-removal date spacing

Goal: Remove the extra space between the Japanese notice date and its particle.

Scope: Correct the Japanese dictionary and assert rendered date boundaries for Japanese, Chinese, Traditional Chinese, and Korean. The Chinese templates already join the date directly to punctuation; Korean already attaches its particle and spaces the following phrase correctly.

Out of scope: English, Spanish, French, deployment, and notice activation.

Acceptance: Japanese joins the date directly to its particle; the other checked locales retain correct spacing. Run the requested full web coverage suite, Astro preview build, Worker tests, and Astro tests. Deliver one small commit on the current branch.
