// Secret words by category. Everyone but the imposter sees one; the imposter may see its category.

export const CATEGORIES = {
  food: {
    label: 'Food',
    words: [
      'Pizza', 'Sushi', 'Tacos', 'Burger', 'Pancakes', 'Ramen', 'Ice Cream', 'Popcorn', 'Spaghetti', 'Burrito',
      'Dumplings', 'Croissant', 'Cheesecake', 'Hot Dog', 'Bagel', 'Waffles', 'Fried Chicken', 'Curry', 'Nachos', 'Donut',
      'Steak', 'Lasagna', 'Pho', 'Mac and Cheese', 'Avocado Toast', 'Boba', 'Cereal', 'Pretzel', 'Grilled Cheese', 'Lobster',
      'Omelette', 'French Fries', 'Kimchi', 'Korean BBQ', 'Birthday Cake', 'Peanut Butter', 'Watermelon', 'Smoothie', 'Fondue', 'Cotton Candy',
    ],
  },
  animals: {
    label: 'Animals',
    words: [
      'Dog', 'Cat', 'Elephant', 'Penguin', 'Giraffe', 'Shark', 'Dolphin', 'Kangaroo', 'Owl', 'Lion',
      'Panda', 'Koala', 'Octopus', 'Flamingo', 'Horse', 'Snake', 'Frog', 'Bat', 'Bee', 'Eagle',
      'Turtle', 'Rabbit', 'Squirrel', 'Zebra', 'Monkey', 'Crocodile', 'Hamster', 'Jellyfish', 'Peacock', 'Sloth',
      'Wolf', 'Polar Bear', 'Camel', 'Parrot', 'Goldfish', 'Seal', 'Raccoon', 'Chicken', 'Spider', 'Whale',
    ],
  },
  places: {
    label: 'Places',
    words: [
      'Beach', 'Airport', 'Hospital', 'Library', 'Movie Theater', 'Gym', 'Casino', 'Zoo', 'Museum', 'Supermarket',
      'Concert', 'Wedding', 'Cruise Ship', 'Ski Resort', 'Haunted House', 'Space Station', 'Submarine', 'Farm', 'Bowling Alley', 'Amusement Park',
      'Coffee Shop', 'Dentist', 'Prison', 'Campsite', 'Nightclub', 'Train Station', 'Hotel', 'Stadium', 'Bank', 'Classroom',
      'Laundromat', 'Karaoke Bar', 'Aquarium', 'Fire Station', 'Desert Island', 'Car Wash', 'Barbershop', 'Pirate Ship', 'Courtroom', 'Spa',
    ],
  },
  jobs: {
    label: 'Jobs',
    words: [
      'Doctor', 'Teacher', 'Firefighter', 'Chef', 'Pilot', 'Astronaut', 'Lawyer', 'Plumber', 'Barista', 'Dentist',
      'Magician', 'Lifeguard', 'Detective', 'Farmer', 'Mail Carrier', 'Photographer', 'DJ', 'Surgeon', 'Judge', 'Personal Trainer',
      'Influencer', 'Architect', 'Mechanic', 'Flight Attendant', 'Electrician', 'Zookeeper', 'Librarian', 'Taxi Driver', 'Wedding Planner', 'Software Engineer',
      'Nurse', 'Scientist', 'Actor', 'Hairdresser', 'Tattoo Artist', 'Coxswain', 'Clown', 'Waiter', 'Spy', 'Bartender',
    ],
  },
  sports: {
    label: 'Sports',
    words: [
      'Soccer', 'Basketball', 'Tennis', 'Golf', 'Rowing', 'Surfing', 'Skiing', 'Boxing', 'Baseball', 'Volleyball',
      'Bowling', 'Swimming', 'Chess', 'Poker', 'Badminton', 'Ping Pong', 'Hockey', 'Skateboarding', 'Yoga', 'Marathon',
      'Rock Climbing', 'Fencing', 'Wrestling', 'Archery', 'Cycling', 'Karate', 'Darts', 'Snowboarding', 'Figure Skating', 'Gymnastics',
      'Football', 'Cricket', 'Lacrosse', 'Sumo', 'Mini Golf', 'Water Polo', 'Horse Racing', 'Pickleball', 'Dodgeball', 'Go Karts',
    ],
  },
  home: {
    label: 'Around the House',
    words: [
      'Toothbrush', 'Fridge', 'Couch', 'Pillow', 'Microwave', 'Mirror', 'Lamp', 'TV Remote', 'Blender', 'Vacuum',
      'Bathtub', 'Toaster', 'Umbrella', 'Doorbell', 'Candle', 'Alarm Clock', 'Washing Machine', 'Curtains', 'Coffee Mug', 'Frying Pan',
      'Ladder', 'Hair Dryer', 'Toilet Paper', 'Laptop', 'Phone Charger', 'Houseplant', 'Rug', 'Bookshelf', 'Oven Mitt', 'Trash Can',
      'Scissors', 'Keys', 'Wallet', 'Sunglasses', 'Backpack', 'Headphones', 'Smoke Alarm', 'Bunk Bed', 'Fish Tank', 'Board Game',
    ],
  },
  screen: {
    label: 'Movies and TV',
    words: [
      'Titanic', 'Jaws', 'Frozen', 'Star Wars', 'Harry Potter', 'Toy Story', 'The Lion King', 'Jurassic Park', 'Shrek', 'The Avengers',
      'Finding Nemo', 'Home Alone', 'Mean Girls', 'Barbie', 'The Matrix', 'Spider-Man', 'Batman', 'Top Gun', 'Up', 'Inception',
      'Rocky', 'Grease', 'The Godfather', 'Ghostbusters', 'Back to the Future', 'Pirates of the Caribbean', 'The Wizard of Oz', 'The Hunger Games', 'Despicable Me', 'Cars',
      'Friends', 'The Office', 'SpongeBob', 'The Simpsons', 'Squid Game', 'Stranger Things', 'Game of Thrones', 'Breaking Bad', 'Pokemon', 'Survivor',
    ],
  },
  college: {
    label: 'College',
    words: [
      'Dorm Room', 'Dining Hall', 'Midterm', 'Office Hours', 'Frat Party', 'Roommate', 'Group Project', 'Spring Break', 'Lecture', 'All-Nighter',
      'Professor', 'Graduation', 'Textbook', 'Campus Tour', 'Study Abroad', 'Internship', 'Career Fair', 'Finals Week', 'Meal Plan', 'Laundry Room',
      'Bike', 'Club Fair', 'Tailgate', 'Syllabus', 'Problem Set', 'Hackathon', 'Instant Noodles', 'Coffee Run', 'Teaching Assistant', 'Orientation',
      'Cramming', 'Pass Fail', 'Formal', 'Rush Week', 'Lab Coat', 'Student ID', 'Dining Dollars', 'Sorority', 'Library Nap', 'Senior Week',
    ],
  },
  party: {
    label: 'Party',
    words: [
      'Karaoke', 'Beer Pong', 'Dance Floor', 'Playlist', 'Confetti', 'Costume', 'Hangover', 'Red Cup', 'Pizza Delivery', 'Photo Booth',
      'Disco Ball', 'Balloons', 'Surprise Party', 'Afterparty', 'Toast', 'Glow Sticks', 'Pool Party', 'Bonfire', 'House Party', 'Limbo',
      'Truth or Dare', 'Pinata', 'Keg', 'Fog Machine', 'Wine Night', 'Game Night', 'Sleepover', 'Party Hat', 'Cake Smash', 'Ice Luge',
      'Flip Cup', 'Bouncer', 'Guest List', 'Selfie', 'Sparklers', 'Hot Tub', 'Slow Dance', 'Rooftop', 'Toga', 'Chips and Dip',
    ],
  },
  travel: {
    label: 'Travel',
    words: [
      'Passport', 'Suitcase', 'Jet Lag', 'Hostel', 'Road Trip', 'Souvenir', 'Map', 'Boarding Pass', 'Tour Guide', 'Camping',
      'Window Seat', 'Layover', 'Backpacking', 'Postcard', 'Paris', 'Tokyo', 'New York', 'Seoul', 'London', 'Hawaii',
      'Las Vegas', 'Rome', 'Iceland', 'Mexico City', 'Sydney', 'Safari', 'Snorkeling', 'Train Ride', 'Gondola', 'Hot Air Balloon',
      'Airbnb', 'Duty Free', 'Sunscreen', 'Selfie Stick', 'Hiking Trail', 'Waterfall', 'Volcano', 'Northern Lights', 'Eiffel Tower', 'Great Wall',
    ],
  },
} as const satisfies Record<string, { label: string; words: readonly string[] }>;

export type CategoryId = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];
