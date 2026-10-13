// Charades decks. Every word has to work both ways, acted out in silence and described out loud, and each deck runs
// from warm-ups to a few that start an argument. No word should be a giveaway for another one in a different deck.

export const DECKS = {
  animals: {
    label: 'Animals',
    words: [
      'Pufferfish', 'Mosquito', 'Elephant', 'Penguin', 'Giraffe', 'Kangaroo', 'Monkey', 'Snake', 'Frog', 'Chicken',
      'Horse', 'Shark', 'Octopus', 'Crab', 'Flamingo', 'Owl', 'Bat', 'Bee', 'Butterfly', 'Spider',
      'Lion', 'Gorilla', 'Sloth', 'Koala', 'Panda', 'Polar Bear', 'Seal', 'Dolphin', 'Whale', 'Jellyfish',
      'Turtle', 'Rabbit', 'Squirrel', 'Raccoon', 'Skunk', 'Porcupine', 'Camel', 'Pigeon', 'Hippo', 'Crocodile',
      'Peacock', 'Woodpecker', 'Ostrich', 'Chameleon', 'T. Rex', 'Duck', 'Vulture', 'Pig', 'Lobster', 'Caterpillar',
    ],
  },
  actions: {
    label: 'Actions',
    words: [
      'Brushing Teeth', 'Tying Shoes', 'Taking a Selfie', 'Riding a Bike', 'Juggling', 'Skydiving', 'Doing Yoga', 'Jump Rope', 'Hula Hoop', 'Assembling IKEA Furniture',
      'Baking a Cake', 'Flipping Pancakes', 'Walking a Dog', 'Milking a Cow', 'Sneezing', 'Swatting a Fly', 'Hiccups', 'Sleepwalking', 'Moonwalking', 'Doing the Worm',
      'Air Guitar', 'Conducting an Orchestra', 'Proposing', 'Getting a Haircut', 'Shaving', 'Parallel Parking', 'Ironing a Shirt', 'Mowing the Lawn', 'Washing Dishes', 'Building a Snowman',
      'Snowball Fight', 'Eating Spaghetti', 'Opening a Stuck Jar', 'Blowing Bubbles', 'Untangling Christmas Lights', 'Knitting', 'Playing Piano', 'Playing Drums', 'Folding a Fitted Sheet', 'Tightrope Walking',
      'Skipping Stones', 'Walking on Ice', 'Stepping on Lego', 'Chasing a Bus', 'Hailing a Taxi', 'Doing a Cartwheel', 'Swinging a Lasso', 'Changing a Tire', 'Putting on Skinny Jeans', 'Popping Popcorn',
    ],
  },
  screen: {
    label: 'Movies and TV',
    words: [
      'Titanic', 'Jaws', 'Frozen', 'The Lion King', 'Star Wars', 'Jurassic Park', 'Harry Potter', 'Finding Nemo', 'Toy Story', 'Shrek',
      'The Matrix', 'Ghostbusters', 'Home Alone', 'Back to the Future', 'The Wizard of Oz', 'Spider-Man', 'Batman', 'Mean Girls', 'Grease', 'Rocky',
      'Top Gun', 'Up', 'Cars', 'Dirty Dancing', 'The Office', 'Friends', 'Stranger Things', 'Squid Game', 'The Simpsons', 'SpongeBob',
      'Game of Thrones', 'Pirates of the Caribbean', 'Mission Impossible', 'The Karate Kid', 'Indiana Jones', 'E.T.', 'King Kong', 'Mary Poppins', 'Barbie', 'Wednesday',
      'The Little Mermaid', 'Beauty and the Beast', 'Aladdin', 'Moana', 'Ratatouille', 'Minions', 'Avatar', 'The Hunger Games', 'Ted Lasso', 'The Great British Bake Off',
    ],
  },
  jobs: {
    label: 'Jobs',
    words: [
      'Doctor', 'Dentist', 'Teacher', 'Firefighter', 'Police Officer', 'Chef', 'Pilot', 'Astronaut', 'Lifeguard', 'Plumber',
      'Electrician', 'Mechanic', 'Tattoo Artist', 'Farmer', 'Fisherman', 'Mail Carrier', 'Pizza Delivery', 'Bus Driver', 'Waiter', 'Barista',
      'Magician', 'Clown', 'Photographer', 'Painter', 'Sculptor', 'DJ', 'Ballet Dancer', 'Stunt Double', 'News Anchor', 'Weather Reporter',
      'Referee', 'Personal Trainer', 'Bouncer', 'Surgeon', 'Vet', 'Zookeeper', 'Librarian', 'Judge', 'Detective', 'Spy',
      'Air Traffic Controller', 'Construction Worker', 'Window Washer', 'Lumberjack', 'Beekeeper', 'Flight Attendant', 'Tour Guide', 'Auctioneer', 'Mime', 'Influencer',
    ],
  },
  sports: {
    label: 'Sports',
    words: [
      'Soccer', 'Basketball', 'Baseball', 'Tennis', 'Golf', 'Bowling', 'Boxing', 'Wrestling', 'Breakdancing', 'Diving',
      'Surfing', 'Skiing', 'Snowboarding', 'Bungee Jumping', 'Hockey', 'Volleyball', 'Badminton', 'Ping Pong', 'Archery', 'Fencing',
      'Karate', 'Gymnastics', 'Weightlifting', 'Rowing', 'Javelin', 'Skateboarding', 'Rock Climbing', 'Horse Riding', 'Darts', 'Pool',
      'Cricket', 'Rugby', 'American Football', 'Curling', 'Bobsled', 'Pole Vault', 'High Jump', 'Hurdles', 'Marathon', 'Sumo',
      'Water Polo', 'Synchronized Swimming', 'Kayaking', 'Mini Golf', 'Dodgeball', 'Tug of War', 'Arm Wrestling', 'Frisbee', 'Pickleball', 'Figure Skating',
    ],
  },
  things: {
    label: 'Things',
    words: [
      'Umbrella', 'Mousetrap', 'Scissors', 'Ladder', 'Balloon', 'Metal Detector', 'Bagpipes', 'Trumpet', 'Telescope', 'Hammer',
      'Chainsaw', 'Vacuum Cleaner', 'Hair Dryer', 'Toaster', 'Blender', 'Fridge', 'Washing Machine', 'Alarm Clock', 'Leaf Blower', 'Wheelbarrow',
      'Trampoline', 'Kite', 'Yo-yo', "Rubik's Cube", 'TV Remote', 'Headphones', 'Sunglasses', 'Backpack', 'Suitcase', 'Sleeping Bag',
      'Tent', 'Lava Lamp', 'Fire Extinguisher', 'Shopping Cart', 'Escalator', 'Elevator', 'Revolving Door', 'Roller Skates', 'Pogo Stick', 'Typewriter',
      'Whoopee Cushion', 'Paper Airplane', 'Snow Globe', 'Rocking Chair', 'Hammock', 'Bubble Wrap', 'Rubber Duck', 'Swing', 'Slinky', 'Magnifying Glass',
    ],
  },
  places: {
    label: 'Famous Places',
    words: [
      'Eiffel Tower', 'Statue of Liberty', 'Great Wall of China', 'The Pyramids', 'Mount Everest', 'Grand Canyon', 'Niagara Falls', 'Big Ben', 'Taj Mahal', 'Colosseum',
      'Leaning Tower of Pisa', 'Golden Gate Bridge', 'Hollywood Sign', 'Times Square', 'Disneyland', 'Las Vegas', 'Sydney Opera House', 'Mount Rushmore', 'Stonehenge', 'Machu Picchu',
      'Amazon Rainforest', 'Sahara Desert', 'North Pole', 'Antarctica', 'Hawaii', 'Venice', 'Paris', 'Tokyo', 'London', 'New York',
      'The Moon', 'Area 51', 'Atlantis', 'Bermuda Triangle', 'Loch Ness', 'Yellowstone', 'Mount Fuji', 'Christ the Redeemer', 'Buckingham Palace', 'The White House',
      'Central Park', 'Alcatraz', 'Easter Island', 'Great Barrier Reef', 'The Louvre', 'Hogwarts', 'Mars', 'Narnia', "Willy Wonka's Factory", 'Route 66',
    ],
  },
  party: {
    label: 'Party',
    words: [
      'Karaoke', 'Limbo', 'Conga Line', 'Musical Chairs', 'Piñata', 'Dance Battle', 'Photo Booth', 'Confetti', 'Blowing Out Candles', 'Surprise Party',
      'Costume Party', 'Pool Party', 'Slow Dance', 'The Macarena', 'The Floss', 'The Robot', 'Crowd Surfing', 'Fist Bump', 'High Five', 'Group Hug',
      'Dad Dancing', 'Disco Ball', 'Glow Sticks', 'Bouncy Castle', 'The Cha Cha Slide', 'Pillow Fight', 'Truth or Dare', 'Awkward Small Talk', 'Third Wheel', 'Photobomb',
      'Sleepover', 'Giving a Toast', 'Party Crasher', 'Leaving Without Saying Bye', 'Red Carpet', 'Fireworks', 'Balloon Animals', 'Face Paint', 'Twister', 'Hide and Seek',
      'Scavenger Hunt', 'Talent Show', 'Encore', 'Last Slice of Pizza', 'Ugly Sweater', 'Food Fight', 'Prom', 'Silent Disco', 'Hot Tub', 'Lip Sync Battle',
    ],
  },
  hard: {
    label: 'Hard Mode',
    words: [
      'Procrastination', 'Déjà Vu', 'Gravity', 'Jealousy', 'Nostalgia', 'Time Travel', 'Inflation', 'Echo', 'Karma', 'Gossip',
      'Awkward Silence', 'Midlife Crisis', 'Imposter Syndrome', "Writer's Block", 'Peer Pressure', 'Sarcasm', 'FOMO', 'Brain Freeze', 'Butterflies in Your Stomach', 'Monday Morning',
      'Daylight Saving Time', 'Leap Year', 'Black Hole', 'Evolution', 'Photosynthesis', 'Wi-Fi', 'Autocorrect', 'Software Update', 'Group Chat', 'Left on Read',
      'Ghosting', 'Buffering', 'Jet Lag', 'Hindsight', 'Dad Joke', 'Butterfly Effect', 'Infinity', 'Opposite Day', 'Plot Twist', 'Spoiler Alert',
      'Cliffhanger', 'Muscle Memory', 'Second Wind', 'Gut Feeling', "Murphy's Law", 'Stage Fright', 'Elevator Music', 'The Floor Is Lava', "Beginner's Luck", 'Main Character Energy',
    ],
  },
} as const satisfies Record<string, { label: string; words: readonly string[] }>;

export type DeckId = keyof typeof DECKS;
export const DECK_IDS = Object.keys(DECKS) as DeckId[];
