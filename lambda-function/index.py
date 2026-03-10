import json, random
def handler(event, context):
    return {"statusCode": 200, "body": json.dumps({"questions": []})}
