# SigLa Mobile Application

The SigLa Mobile Application is the primary interface for users to interact with the system. It supports Filipino Sign Language (FSL) for common daily communication and allows users to perform gesture recognition, browse the word bank, contribute new gesture samples, receive notifications, and manage their account. The application supports both **static** gestures (still hand positions) and **motion** gestures (moving gestures).

The application contains the following modules: **Main Interface**, **Word Bank**, **Translation History**, **Suggest a Word**, **Notifications**, **Profile**, and **Settings**.

---

## General Behavior

The translation process runs directly on the device, which means gesture recognition and translation work **offline** without an internet connection. An internet connection is only required when the user creates an account, logs in, loads the latest notifications, or submits a new word suggestion.

When the device is connected to the internet, the application automatically downloads the latest gesture recognition model in the background. Before replacing the currently active model, the system performs a **model integrity verification** by computing the SHA-256 checksum of the downloaded file and comparing it against the expected value provided by the server. If the checksums do not match, or if the download fails, the previously installed model remains active so that gesture recognition continues to work without interruption.

The system applies a **two-second loading** period between each gesture detection. This is set to ensure stable and accurate recognition and to prevent unintended repeated detections. As a result, static gestures typically require approximately **2 to 3 seconds** to detect and translate, while motion gestures generally require around **3 to 5 seconds**. After a gesture is recognized, the system displays the translated text on screen and plays an audio output of the result. The system also supports **text-to-speech** translation, allowing the translated text to be spoken aloud through the device's audio output to help communicate with people who do not use sign language.

The application supports assistance in daily interactions across the following categories: introducing oneself, ordering food, buying items, asking for prices, giving numbers such as age, phone numbers, or addresses, requesting assistance, asking for directions, confirming information, communicating basic needs such as expressing hunger, thirst, pain, or discomfort, requesting water, food, or medicine, asking to use the restroom, expressing feelings such as being tired, scared, or unwell, as well as alphabets, numbers, and additional words.

---

## Onboarding Tutorial

When the user opens the application for the first time, the system displays a brief **onboarding tutorial** that guides the user through the main features. The tutorial introduces the Main Interface and explains how gesture detection works, how to use the Word Bank, how to submit a word through the Suggest a Word module, and how to navigate the application using the retractable sidebar. The tutorial is shown only once upon first launch and can be skipped at any time. Users may also revisit the tutorial at any time through the **Settings** module.

---

## Main Interface

The Main Interface is the primary translation screen where the user performs gesture recognition using the device camera. The interface automatically detects and translates sign language gestures as soon as the camera is active, without requiring any additional input from the user.

After detecting a gesture, the system displays the corresponding translated text in **English** along with its **Filipino translation** below it, and plays an audio output of the detected gesture. The user can turn off the Filipino translation by pressing the **Filipino translation button**. To ensure accurate and stable detection, the system applies a two-second loading period after each recognized gesture before accepting a new one.

The interface includes a **camera switch button** that allows the user to switch between the front and rear camera. It also includes an **emergency button** that, when pressed and held for two seconds, plays an audio alert saying "Help me" to quickly notify nearby individuals in urgent situations. The two-second hold requirement prevents accidental activation while still allowing the feature to be used quickly when needed.

A **retractable sidebar** serves as the navigation menu, allowing users to access the Word Bank, Suggest a Word, Settings, Notifications, and Profile modules.

---

## Word Bank

The Word Bank module allows users to view the list of words that can currently be translated by the application. It includes a **category dropdown** that allows users to filter entries by category, including introducing oneself, ordering food, buying items, asking for prices, giving numbers, requesting assistance, asking for directions, confirming information, communicating basic needs, alphabets, numbers, and additional words.

Selecting a word entry plays an audio pronunciation of the corresponding word or letter. For **motion** gestures, it also displays a short **demonstration video** showing how the gesture is performed. This video is generated on the server from the approved gesture samples collected for that word. For **static** gestures, a picture of the sign is displayed instead of a video.

Users may personalize their Word Bank experience by creating **custom categories** to organize their most used or favorite gestures. A **create category button** allows the user to add a new category with a custom name, and gesture entries can be added to these custom categories by selecting them from the existing word list. Custom categories appear alongside the default categories in the category dropdown, allowing users to quickly filter and access the gestures they use most. Users may also **rename** or **delete** their custom categories at any time. Custom categories and their entries are stored locally on the device and are specific to each user's account.

The module includes a retractable sidebar and a back button to return to the main interface.

---

## Translation History

The Translation History module allows users to view a record of all gestures that have been recognized and translated by the application during previous sessions. Each entry displays the **translated word**, the **confidence percentage** of the recognition, the **gesture type** indicating whether the gesture was static or motion-based, and the **time** the translation was detected. Entries are grouped by date, with the most recent translations appearing at the top of the list.

The translation history is stored locally on the device and can hold a maximum of **200 entries**. Older entries are automatically removed once the limit is reached to manage storage. Users may delete individual entries by swiping left on an entry or by tapping the delete button. Users may also clear the entire translation history at once using the **clear all button**, which requires confirmation before the entries are permanently removed.

The module includes a retractable sidebar and a back button to return to the main interface.

---

## Suggest a Word

The Suggest a Word module allows registered users to submit a new sign language gesture that is not yet included in the system. To submit a word, the user must enter the **word** and its **description**, specify whether the gesture requires **one or both hands**, select whether the gesture is **static or motion-based**, and check the "I have read the terms and conditions" checkbox before the **start collecting button** becomes available.

The terms and conditions inform the user that their captured gesture images and the corresponding word may be displayed in the Word Bank of the mobile application if approved by the administrator, that the submitted samples may be used for training the gesture recognition model, and that submitting inappropriate or offensive content may result in account deactivation leading to permanent deletion of the user account.

Before the start collecting button becomes available, the system first **normalizes** the submitted word by converting it to lowercase, removing unnecessary punctuation, and then capitalizing the first letter. The system then checks whether the word already exists in the database. This prevents duplicate entries caused by capitalization or punctuation differences. If the word does not exist, the start collecting button becomes available and the user may proceed with collection. If the word already exists, the application displays a prompt notifying the user. The user may either cancel the process or continue contributing gesture samples to the existing word entry. If the administrator has **locked** the word, users will no longer be allowed to submit gesture samples for it.

Once the user chooses to proceed, the system displays an instruction informing the user that gesture samples should be captured from different angles and hand positions to improve accuracy, and that the collection process will approximately take 3 to 5 minutes. After confirming, the system begins data collection using the device camera and captures a maximum of **75 gesture samples** for static gestures and a maximum of **50 gesture samples** for motion gestures. A **camera switch button** allows the user to switch between the front and rear camera, while a **cancel button** allows the user to stop the collection at any time. If the user cancels, the entire collection process is terminated and all captured samples are discarded.

The system performs **automated validation** before storing each sample by verifying that a detectable hand landmark structure exists and that the hand occupies a valid region of the frame. For each validated sample, the system performs two operations simultaneously: the image frame is saved as a photograph so that administrators can visually review the submission, and at the same time the system extracts **126 normalized hand landmark coordinates** using the **MediaPipe** hand detection framework. These coordinates represent the precise positions of the hand joints during the gesture and serve as the data used for training the gesture recognition model. Both the captured images and their corresponding landmark data are stored together and uploaded to the server once the user clicks the **submit button**. Before being stored, the captured images are compressed and resized to reduce file size. If no hands are detected during collection, the system displays a "No Hands Detected" message.

All submitted samples are stored securely and are accessible only to authorized administrators for review and model training. If a user account is permanently deleted, the account information is removed, but any gesture samples that have already been submitted and reviewed are retained to preserve the integrity of the gesture recognition dataset.

Each user is allowed to contribute a maximum of **75 samples per static gesture** and **50 samples per motion gesture** across all of their submissions combined. Once a user's submission for a specific word has been **approved** by the administrator, that user can no longer add more samples to that same word. If the submission is **rejected**, the user may submit again for the same word provided their total contribution has not yet reached the sample cap. Each user has an independent sample quota per word, meaning other users may still contribute their own samples to the same word regardless of how many samples another user has submitted. If a user has already reached the maximum allowance for a specific word, the system will display a prompt that no further samples can be submitted for that word. The user may still contribute to other words that have not yet reached their required number of samples.

The module includes a retractable sidebar and a back button to return to the main interface.

---

## Notifications

The Notifications module informs users about important system updates and the status of their submissions. It delivers announcements from the administrator, including upcoming maintenance schedules, system updates, approval or denial of word submissions, warnings, and other relevant notices.

Notifications are stored on the server and delivered to users through this module. The application **caches** the most recently loaded notifications on the device so that they remain viewable even without an internet connection. When the user is offline, the module displays the cached notifications along with a message indicating that the connection is unavailable. When the device reconnects to the internet, the module automatically refreshes and loads the latest notifications from the server. An internet connection is required to receive new notifications and to load the latest updates.

The module includes a retractable sidebar and a back button to return to the main interface.

---

## Profile

The Profile module allows users to manage their account information. It provides an **edit information button** that allows users to update their name and username. The registered email address is displayed but cannot be changed because it was verified during account registration.

It also includes a **change password button** that allows the user to update their account password. To change the password, the user must first verify their identity by entering the correct **six-digit verification code** sent to their registered email address before inputting a new password.

A **save button** is provided to confirm and apply any changes made to the account information. The module also includes a **logout button** that allows users to securely exit their account. It has a retractable sidebar.

---

## Settings

The Settings module allows users to configure application preferences. Users can adjust the **volume level**, select a **voice type** (male or female) for text-to-speech output, change the **text size** of the translation display, and toggle between **light and dark mode** using toggle switches. A **reset to default button** restores all settings to their original configuration. The module also includes an option to **replay the onboarding tutorial** for users who wish to review the application guide. It has a retractable sidebar and a back button to return to the main interface.
