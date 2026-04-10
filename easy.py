list = [1, 2, 3, 4, 5]
target = 6

box = {}

def two_sum(list, target):
    for i, num in enumerate(list):
        diff = target - num
        if diff in box:
            return [box[diff], i]
        box[num] = i
    return None

print(two_sum(list, target))